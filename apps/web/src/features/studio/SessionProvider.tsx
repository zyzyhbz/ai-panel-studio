import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import { useReducedMotion } from "../../lib/useReducedMotion";

import { endDiscussion, getDiscussion, confirmDiscussion } from "../../api/discussions";
import { ApiError, friendlyMessage } from "../../api/client";
import { SessionStream, type ConnectionState } from "../../api/sse";
import { sessionReducer, type SessionAction } from "../../domain/reducer";
import {
  emptySession,
  hydrateFromDetail,
  shouldStream,
  type SessionView,
} from "../../domain/session";
import { StreamBuffer } from "../../domain/streamBuffer";

export interface ConnectionInfo {
  state: ConnectionState;
  attempt: number;
  nextRetryMs?: number;
  reason?: string;
}

interface SessionContextValue {
  view: SessionView;
  dispatch: Dispatch<SessionAction>;
  buffer: StreamBuffer;
  connection: ConnectionInfo;
  loadState: "loading" | "ready" | "error";
  loadError: string | null;
  notFound: boolean;
  refresh: () => Promise<void>;
  reconnectNow: () => void;
  requestEnd: () => Promise<void>;
  /** Confirm the roster; always re-reads the projection afterwards. */
  confirm: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>");
  return value;
}

export function SessionProvider({
  discussionId,
  children,
  initialTopic,
}: {
  discussionId: string;
  children: ReactNode;
  initialTopic?: string;
}) {
  const reducedMotion = useReducedMotion() ?? false;

  const [view, dispatch] = useReducer(
    sessionReducer,
    discussionId,
    (id): SessionView => ({
      ...emptySession(id),
      topic: initialTopic ?? "",
    }),
  );

  const viewRef = useRef(view);
  viewRef.current = view;

  const bufferRef = useRef<StreamBuffer | null>(null);
  if (bufferRef.current === null) {
    bufferRef.current = new StreamBuffer();
  }
  const buffer = bufferRef.current;

  const streamRef = useRef<SessionStream | null>(null);

  const [connection, setConnection] = useState<ConnectionInfo>({ state: "idle", attempt: 0 });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    buffer.setReducedMotion(reducedMotion);
  }, [buffer, reducedMotion]);

  /* ---------------------------------------------------------------- *
   * Initial + manual hydrate. The REST snapshot is the only source for
   * `topic` and for the starting `lastSeq`; the stream only covers "from
   * now on".
   * ---------------------------------------------------------------- */
  const hydrate = useCallback(
    async (signal?: AbortSignal) => {
      const detail = await getDiscussion(discussionId, signal);
      dispatch({ type: "hydrate", detail });
      const seq = hydrateFromDetail(viewRef.current, detail).lastSeq;
      streamRef.current?.setLastSeq(seq);
      return detail;
    },
    [discussionId],
  );

  const refresh = useCallback(async () => {
    try {
      await hydrate();
    } catch {
      /* transient — the reducer already holds a usable projection */
    }
  }, [hydrate]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoadState("loading");
    setLoadError(null);

    getDiscussion(discussionId, controller.signal)
      .then((detail) => {
        if (cancelled) return;
        dispatch({ type: "hydrate", detail });
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.code === "ABORTED") return;
        if (error instanceof ApiError && (error.status === 404 || error.code === "NOT_FOUND")) {
          setNotFound(true);
          setLoadError(friendlyMessage(error));
          setLoadState("error");
          return;
        }
        setLoadError(friendlyMessage(error));
        setLoadState("error");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [discussionId]);

  /* ---------------------------------------------------------------- *
   * Stream lifecycle. Keyed on the boolean, not on `status`, so that
   * live → summarizing does NOT tear the connection down and reconnect.
   * ---------------------------------------------------------------- */
  const streaming = shouldStream(view.status);
  const lastSeqRef = useRef(0);
  lastSeqRef.current = view.lastSeq;

  useEffect(() => {
    if (!streaming) {
      streamRef.current?.dispose();
      streamRef.current = null;
      return;
    }
    if (streamRef.current) return;

    const stream = new SessionStream({
      discussionId,
      afterSeq: lastSeqRef.current,
      onEvent: (event) => {
        if (event.type === "turn.started") {
          buffer.begin(event.payload.messageId, event.payload.speakerId);
        }
        if (event.type === "message.completed") {
          buffer.complete(event.payload.message?.id ?? "");
        }
        if (
          event.type === "discussion.ended" ||
          event.type === "discussion.failed" ||
          event.type === "turn.aborted"
        ) {
          buffer.clear();
        }
        dispatch({ type: "event", event });
      },
      onDelta: (delta) => {
        buffer.append(delta.messageId, delta.delta);
      },
      onSignal: (signal) => {
        const ready = signal.ready;
        if (!ready) return;
        // The connection often opens *after* the run already finished (mock
        // LLM is instant, and a reload of a live session is seconds behind).
        // `SessionStream` closes itself on a terminal status, so no backfill
        // will arrive — rehydrate from REST or the stage stays an empty shell.
        const terminal = ready.status === "ended" || ready.status === "failed";
        if (terminal || ready.status !== viewRef.current.status) {
          void refresh();
        }
      },
      onState: (state, meta) => {
        setConnection({
          state,
          attempt: meta.attempt,
          nextRetryMs: meta.nextRetryMs,
          reason: meta.reason,
        });
      },
      onGap: () => {
        // A hole in `seq` is cheaper to fix by re-reading the projection than
        // by merging partial events and hoping the order is right.
        buffer.clear();
        void refresh();
      },
      onFatal: () => {
        /* surfaced through onState('fatal') — the banner handles it */
      },
    });

    streamRef.current = stream;
    stream.start();

    return () => {
      stream.dispose();
      if (streamRef.current === stream) streamRef.current = null;
    };
  }, [streaming, discussionId, buffer, refresh]);

  /* Degraded mode: no EventSource — poll instead. */
  useEffect(() => {
    if (connection.state !== "degraded") return;
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [connection.state, refresh]);

  /* Coming back to the tab: reconcile once. */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (viewRef.current.status === "ended" || viewRef.current.status === "failed") return;
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const reconnectNow = useCallback(() => {
    streamRef.current?.reconnectNow();
  }, []);

  const requestEnd = useCallback(async () => {
    dispatch({ type: "localStatus", status: "summarizing" });
    try {
      await endDiscussion(discussionId);
    } catch (error) {
      // 409 / network: fall back to whatever the server actually thinks.
      if (error instanceof ApiError && error.code === "INVALID_STATE") {
        await refresh();
        return;
      }
      throw error;
    }
    // The summary may already be finished (fast mock); reconcile either way.
    await refresh();
  }, [discussionId, refresh]);

  /**
   * Confirm → immediately re-read the projection.
   *
   * Flipping the local status to `live` alone is not enough: the run can
   * already be over by the time the stream opens, and `SessionStream` closes
   * on a terminal `stream.ready` without backfilling. Without this second
   * fetch the stage renders as an empty shell (BUG-01).
   */
  const confirm = useCallback(async () => {
    await confirmDiscussion(discussionId);
    dispatch({ type: "localStatus", status: "live" });
    await refresh();
  }, [discussionId, refresh]);

  const value = useMemo<SessionContextValue>(
    () => ({
      view,
      dispatch,
      buffer,
      connection,
      loadState,
      loadError,
      notFound,
      refresh,
      reconnectNow,
      requestEnd,
      confirm,
    }),
    [
      view,
      buffer,
      connection,
      loadState,
      loadError,
      notFound,
      refresh,
      reconnectNow,
      requestEnd,
      confirm,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
