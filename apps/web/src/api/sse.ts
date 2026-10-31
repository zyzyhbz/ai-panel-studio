import { SSE_EVENT_TYPES } from "@ai-panel/shared";
import type {
  ErrorFrame,
  MessageDeltaFrame,
  PersistedEvent,
  PersistedEventType,
  StreamCaughtUpFrame,
  StreamReadyFrame,
} from "./types";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "degraded"
  | "fatal";

export interface ConnectionMeta {
  attempt: number;
  nextRetryMs?: number;
  reason?: string;
}

export interface StreamSignal {
  ready?: StreamReadyFrame;
  caughtUp?: StreamCaughtUpFrame;
  serverError?: ErrorFrame;
}

export interface SessionStreamOptions {
  discussionId: string;
  afterSeq: number;
  onEvent: (event: PersistedEvent) => void;
  onDelta: (delta: MessageDeltaFrame) => void;
  onSignal: (signal: StreamSignal) => void;
  onState: (state: ConnectionState, meta: ConnectionMeta) => void;
  /** The client noticed a hole in the seq sequence; re-hydrate from REST. */
  onGap: (fromSeq: number, toSeq: number) => void;
  onFatal: (error: { code: string; message: string }) => void;
}

const PERSISTED = new Set<string>([
  "roster.ready",
  "discussion.started",
  "discussion.summarizing",
  "turn.started",
  "message.completed",
  "turn.aborted",
  "insight.updated",
  "summary.completed",
  "discussion.ended",
  "discussion.failed",
]);

/** 0.5s → 10s, six tries (~25s) before we give up and go fatal. */
const BACKOFF = [500, 1000, 2000, 4000, 8000, 10000];
const MAX_ATTEMPTS = 6;

function backoffFor(attempt: number): number {
  const base = BACKOFF[Math.min(attempt, BACKOFF.length - 1)] ?? 10_000;
  return base + Math.floor(Math.random() * 250);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Self-managed SSE reconnect.
 *
 * Why not the browser's built-in retry:
 *  - it re-requests the ORIGINAL url, so `after` stays frozen at the first
 *    connection and the server re-sends everything;
 *  - it cannot be told to stop (404 / ended → infinite hammering);
 *  - it cannot surface attempt counts to the UI.
 * So we always `close()` synchronously on transport error and own the timer.
 */
export class SessionStream {
  private readonly opts: SessionStreamOptions;
  private source: EventSource | null = null;
  private timer: number | null = null;
  private attempt = 0;
  private lastSeq: number;
  private state: ConnectionState = "idle";
  private disposed = false;
  private sawReady = false;

  constructor(options: SessionStreamOptions) {
    this.opts = options;
    this.lastSeq = options.afterSeq;
  }

  getState(): ConnectionState {
    return this.state;
  }

  getLastSeq(): number {
    return this.lastSeq;
  }

  /** Advance our watermark when the provider applies an event by other means. */
  setLastSeq(seq: number): void {
    this.lastSeq = Math.max(this.lastSeq, seq);
  }

  start(): void {
    if (this.disposed) return;
    if (typeof EventSource === "undefined") {
      this.transition("degraded", { attempt: 0, reason: "unsupported" });
      return;
    }
    if (this.source) return;

    this.transition("connecting", { attempt: this.attempt });
    const url = `/api/discussions/${encodeURIComponent(
      this.opts.discussionId,
    )}/stream?after=${this.lastSeq}`;

    let source: EventSource;
    try {
      source = new EventSource(url);
    } catch {
      this.scheduleReconnect("constructor_failed");
      return;
    }
    this.source = source;
    this.sawReady = false;

    for (const type of SSE_EVENT_TYPES) {
      if (type === "error") continue; // handled below — it shares the native channel
      source.addEventListener(type, (event) => this.handle(type, event as MessageEvent));
    }

    // `error` is overloaded: the browser fires a plain Event for transport
    // failures, while the server may send a named `error` MessageEvent.
    source.addEventListener("error", (event) => {
      const message = event as MessageEvent<string>;
      if (typeof message.data === "string" && message.data.length > 0) {
        this.handleServerError(message);
        return;
      }
      this.handleTransportError();
    });
  }

  reconnectNow(): void {
    if (this.disposed) return;
    this.attempt = 0;
    this.closeSource();
    this.clearTimer();
    this.start();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.closeSource();
    this.transition("closed", { attempt: this.attempt });
  }

  /* ---------------------------------------------------------------- */

  private handle(type: string, event: MessageEvent<string>): void {
    if (this.disposed) return;

    if (type === "message.delta") {
      const payload = parseJson(event.data);
      if (payload && typeof payload === "object") {
        this.opts.onDelta(payload as MessageDeltaFrame);
      }
      return;
    }

    if (type === "stream.ready") {
      const payload = parseJson(event.data) as StreamReadyFrame | null;
      this.sawReady = true;
      this.attempt = 0;
      // NB: never advance lastSeq to payload.lastSeq — that would skip the
      // backfill the server is about to send us.
      this.transition("open", { attempt: 0 });
      if (payload) this.opts.onSignal({ ready: payload });
      if (payload?.status === "ended" || payload?.status === "failed") {
        this.disposed = true;
        this.clearTimer();
        this.closeSource();
        this.transition("closed", { attempt: 0, reason: payload.status });
      }
      return;
    }

    if (type === "stream.caught_up") {
      const payload = parseJson(event.data) as StreamCaughtUpFrame | null;
      if (payload) this.opts.onSignal({ caughtUp: payload });
      return;
    }

    if (!PERSISTED.has(type)) return;

    const seq = Number(event.lastEventId);
    if (!Number.isFinite(seq) || seq <= 0) return;
    if (seq <= this.lastSeq) return; // duplicate after replay/backfill

    const payload = parseJson(event.data);
    if (payload === null) return;

    const hole = seq > this.lastSeq + 1;
    const from = this.lastSeq + 1;

    const persisted = {
      seq,
      type: type as PersistedEventType,
      payload,
      createdAt: new Date().toISOString(),
    } as PersistedEvent;

    this.lastSeq = seq;
    this.opts.onEvent(persisted);

    if (hole) this.opts.onGap(from, seq - 1);

    if (type === "discussion.ended" || type === "discussion.failed") {
      this.disposed = true;
      this.clearTimer();
      this.closeSource();
      this.transition("closed", { attempt: 0, reason: type });
    }
  }

  private handleServerError(event: MessageEvent<string>): void {
    const payload = parseJson(event.data) as ErrorFrame | null;
    if (!payload) return;
    this.opts.onSignal({ serverError: payload });
    if (payload.recoverable === false) {
      this.disposed = true;
      this.clearTimer();
      this.closeSource();
      this.opts.onFatal({
        code: payload.code ?? "INTERNAL",
        message: payload.message ?? "实时连接出错。",
      });
      this.transition("fatal", { attempt: this.attempt, reason: payload.code });
    }
  }

  private handleTransportError(): void {
    // Capture before closing — `closeSource()` nulls the reference.
    const readyState = this.source?.readyState;
    this.closeSource();
    if (this.disposed) return;

    // readyState 2 (CLOSED) is what a 404 / non-200 produces. Retry a few
    // times, then give up rather than hammering a dead endpoint forever.
    this.scheduleReconnect(readyState === 2 ? "closed_by_server" : "transport_error");
  }

  private scheduleReconnect(reason: string): void {
    if (this.disposed) return;
    this.clearTimer();

    if (this.attempt >= MAX_ATTEMPTS) {
      this.transition("fatal", { attempt: this.attempt, reason });
      this.opts.onFatal({
        code: "STREAM_UNAVAILABLE",
        message: "实时连接中断，已多次重试仍失败。",
      });
      return;
    }

    const delay = backoffFor(this.attempt);
    const attempt = this.attempt + 1;
    this.transition("reconnecting", {
      attempt,
      nextRetryMs: delay,
      reason,
    });

    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.attempt = attempt;
      this.start();
    }, delay);
  }

  private transition(state: ConnectionState, meta: ConnectionMeta): void {
    this.state = state;
    this.opts.onState(state, meta);
  }

  private closeSource(): void {
    if (!this.source) return;
    this.source.close();
    this.source = null;
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    window.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Used by tests / the degraded path. */
  get hasOpened(): boolean {
    return this.sawReady;
  }
}
