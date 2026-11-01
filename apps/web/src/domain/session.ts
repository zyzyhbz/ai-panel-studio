import { plannedTurnsFor, maxTurnsFor } from "@ai-panel/shared";
import type {
  ActiveTurn,
  DiscussionDetail,
  DiscussionState,
  DiscussionStatus,
  Expert,
  Insight,
  Message,
  Summary,
} from "../api/types";

export interface TurnNotice {
  turnIndex: number;
  speakerId: string;
  speakerName: string | null;
  reason: string;
  at: string;
}

/**
 * The single projection used by BOTH live and replay.
 *
 * Invariant I1: `events.reduce(applyEvent, emptySession)` must equal
 * `hydrate(detail)` for the same discussion — that is the formal definition of
 * "回放与直播一致". Anything that cannot be rebuilt from events (streaming
 * text, scroll position, drawer state) must live outside this object.
 */
export interface SessionView {
  discussionId: string;
  topic: string;
  status: DiscussionStatus;
  expertCount: number;
  turnCount: number;
  plannedTurns: number;
  maxTurns: number;
  /** Highest applied seq. Monotonic — never goes backwards. */
  lastSeq: number;
  roster: Expert[];
  messages: Message[];
  insights: Insight[];
  summary: Summary | null;
  activeTurn: ActiveTurn | null;
  /** When the current turn started (ISO). Used for 准备发言 → 思考中. */
  turnStartedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  summarizing: { reason: "user" | "auto"; startedAt: string } | null;
  failure: { code: string; message: string; retryable: boolean } | null;
  notices: TurnNotice[];
}

export function emptySession(discussionId: string): SessionView {
  return {
    discussionId,
    topic: "",
    status: "generating",
    expertCount: 0,
    turnCount: 0,
    plannedTurns: 0,
    maxTurns: 0,
    lastSeq: 0,
    roster: [],
    messages: [],
    insights: [],
    summary: null,
    activeTurn: null,
    turnStartedAt: null,
    startedAt: null,
    endedAt: null,
    summarizing: null,
    failure: null,
    notices: [],
  };
}

function turnsFor(expertCount: number, planned?: number, max?: number) {
  const count = expertCount > 0 ? expertCount : 0;
  return {
    plannedTurns: planned ?? plannedTurnsFor(count),
    maxTurns: max ?? maxTurnsFor(count),
  };
}

/** Insert keeping transcript ordering stable even if events arrive out of order. */
export function insertMessage(messages: Message[], incoming: Message): Message[] {
  if (messages.some((m) => m.id === incoming.id)) {
    return messages.map((m) => (m.id === incoming.id ? incoming : m));
  }
  const next = [...messages, incoming];
  next.sort((a, b) => {
    if (a.turnIndex !== b.turnIndex) return a.turnIndex - b.turnIndex;
    return a.createdAt.localeCompare(b.createdAt);
  });
  return next;
}

export interface HydrateInput {
  topic?: string;
  discussion: {
    id: string;
    status: DiscussionStatus;
    expertCount?: number;
    turnCount?: number;
    lastSeq?: number;
    plannedTurns?: number;
    maxTurns?: number;
    startedAt?: string | null;
    endedAt?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  };
  experts: Expert[];
  messages: Message[];
  insights: Insight[];
  summary: Summary | null;
  activeTurn?: ActiveTurn | null;
}

export function hydrate(view: SessionView, input: HydrateInput): SessionView {
  const { discussion } = input;
  const expertCount = discussion.expertCount ?? input.experts.length;
  const turns = turnsFor(expertCount, discussion.plannedTurns, discussion.maxTurns);

  const terminal =
    discussion.status === "ended" || discussion.status === "failed";

  return {
    ...view,
    discussionId: discussion.id,
    topic: input.topic ?? view.topic,
    status: discussion.status,
    expertCount,
    turnCount: discussion.turnCount ?? view.turnCount,
    plannedTurns: turns.plannedTurns,
    maxTurns: turns.maxTurns,
    lastSeq: Math.max(view.lastSeq, discussion.lastSeq ?? 0),
    roster: input.experts.length > 0 ? input.experts : view.roster,
    messages: input.messages,
    insights: input.insights,
    summary: input.summary,
    activeTurn: terminal ? null : (input.activeTurn ?? null),
    turnStartedAt: terminal ? null : (input.activeTurn ? view.turnStartedAt : null),
    startedAt: discussion.startedAt ?? view.startedAt,
    endedAt: discussion.endedAt ?? view.endedAt,
    failure:
      discussion.status === "failed"
        ? {
            code: discussion.errorCode ?? "INTERNAL",
            message: discussion.errorMessage ?? "这场讨论中断了。",
            retryable: false,
          }
        : null,
  };
}

export function hydrateFromDetail(
  view: SessionView,
  detail: DiscussionDetail,
): SessionView {
  return hydrate(view, {
    topic: detail.discussion.topic,
    discussion: detail.discussion,
    experts: detail.experts ?? [],
    messages: detail.messages ?? [],
    insights: detail.insights ?? [],
    summary: detail.summary ?? null,
    activeTurn: detail.activeTurn ?? null,
  });
}

export function hydrateFromState(
  view: SessionView,
  state: DiscussionState,
): SessionView {
  return hydrate(view, {
    discussion: {
      id: state.discussionId,
      status: state.status,
      turnCount: state.turnCount,
      lastSeq: state.lastSeq,
      expertCount: state.experts.length,
    },
    experts: state.experts ?? [],
    messages: state.messages ?? [],
    insights: state.insights ?? [],
    summary: state.summary ?? null,
    activeTurn: state.activeTurn ?? null,
  });
}

/** Is the session finished (no more events will ever arrive)? */
export function isTerminal(status: DiscussionStatus): boolean {
  return status === "ended" || status === "failed";
}

/** Should the studio connect to SSE? */
export function shouldStream(status: DiscussionStatus): boolean {
  return status === "live" || status === "summarizing";
}
