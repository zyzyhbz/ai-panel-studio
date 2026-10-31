import type {
  DiscussionStatus,
  InsightType,
  Intent,
  Polarity,
  SseEventType,
  TurnAbortReason,
} from "@ai-panel/shared";

export type {
  DiscussionStatus,
  InsightType,
  Intent,
  Polarity,
  TurnAbortReason,
};

/* ------------------------------------------------------------------ *
 * REST resources (API contract v1.0, see docs/06-G1契约决议.md)
 * ------------------------------------------------------------------ */

export interface Expert {
  id: string;
  role: "host" | "expert";
  name: string;
  profession: string;
  title: string;
  stance: string;
  stanceAxis: string;
  polarity: Polarity;
  color: string;
  focusArea: string;
  sortOrder: number;
}

export interface Message {
  id: string;
  expertId: string;
  speakerName: string;
  speakerTitle: string;
  speakerColor: string;
  content: string;
  intent: Intent;
  turnIndex: number;
  charCount?: number;
  degraded?: boolean;
  targetMessageId?: string;
  references?: string[];
  createdAt: string;
}

export interface Insight {
  id: string;
  type: InsightType;
  content: string;
  evidenceMessageIds: string[];
  firstSeenTurn?: number;
  updatedAt: string;
}

export interface Summary {
  content: string;
  isFallback?: boolean;
  createdAt: string;
}

export interface ActiveTurn {
  turnIndex: number;
  speakerId: string;
  messageId: string;
  intent: Intent;
  turnFocus: string;
  references?: string[];
}

export interface Discussion {
  id: string;
  topic: string;
  status: DiscussionStatus;
  expertCount: number;
  turnCount: number;
  lastSeq: number;
  plannedTurns?: number;
  maxTurns?: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface DiscussionListItem extends Discussion {
  hostName?: string | null;
  experts?: Expert[];
  summaryPreview?: string | null;
  errorCode: string | null;
}

export interface DiscussionDetail {
  discussion: Discussion;
  experts: Expert[];
  messages: Message[];
  insights: Insight[];
  summary: Summary | null;
  activeTurn: ActiveTurn | null;
}

/** `GET /api/discussions/:id/state` — event-replayed projection. */
export interface DiscussionState {
  discussionId: string;
  status: DiscussionStatus;
  turnCount: number;
  lastSeq: number;
  experts: Expert[];
  messages: Message[];
  insights: Insight[];
  summary: Summary | null;
  activeTurn?: ActiveTurn | null;
}

export interface ListResponse {
  items: DiscussionListItem[];
  total: number;
}

export interface CreateResponse {
  discussion: Discussion;
  experts: Expert[];
}

export interface ConfirmResponse {
  discussion: Discussion;
}

export interface EndResponse {
  discussion: Discussion;
}

/* ------------------------------------------------------------------ *
 * Events — `payload_json` is exactly the SSE `data` object, and
 * `GET /events` returns it verbatim (decision I-3).
 * ------------------------------------------------------------------ */

export interface RosterPayload {
  discussionId: string;
  experts: Expert[];
}

export interface StartedPayload {
  discussionId: string;
  startedAt: string;
}

export interface SummarizingPayload {
  discussionId: string;
  reason: "user" | "auto";
  startedAt: string;
}

export interface TurnStartedPayload {
  discussionId: string;
  turnIndex: number;
  speakerId: string;
  messageId: string;
  intent: Intent;
  turnFocus: string;
  targetMessageId?: string;
  references?: string[];
}

export interface MessageCompletedPayload {
  discussionId: string;
  message: Message;
}

export interface TurnAbortedPayload {
  discussionId: string;
  turnIndex: number;
  speakerId: string;
  messageId?: string;
  reason: TurnAbortReason | string;
  retryable: boolean;
}

export interface InsightUpdatedPayload {
  discussionId: string;
  insights: Insight[];
}

export interface SummaryCompletedPayload {
  discussionId: string;
  summary: Summary;
}

export interface EndedPayload {
  discussionId: string;
  endedAt: string;
}

export interface FailedPayload {
  discussionId: string;
  code: string;
  message: string;
  retryable: boolean;
  failedAt: string;
}

export type PersistedEventType =
  | "roster.ready"
  | "discussion.started"
  | "discussion.summarizing"
  | "turn.started"
  | "message.completed"
  | "turn.aborted"
  | "insight.updated"
  | "summary.completed"
  | "discussion.ended"
  | "discussion.failed";

export interface EventOf<T extends PersistedEventType, P> {
  seq: number;
  type: T;
  payload: P;
  createdAt: string;
}

export type PersistedEvent =
  | EventOf<"roster.ready", RosterPayload>
  | EventOf<"discussion.started", StartedPayload>
  | EventOf<"discussion.summarizing", SummarizingPayload>
  | EventOf<"turn.started", TurnStartedPayload>
  | EventOf<"message.completed", MessageCompletedPayload>
  | EventOf<"turn.aborted", TurnAbortedPayload>
  | EventOf<"insight.updated", InsightUpdatedPayload>
  | EventOf<"summary.completed", SummaryCompletedPayload>
  | EventOf<"discussion.ended", EndedPayload>
  | EventOf<"discussion.failed", FailedPayload>;

export type PersistedEventOf<T extends PersistedEventType> = Extract<
  PersistedEvent,
  { type: T }
>;

export interface EventsResponse {
  items: PersistedEvent[];
  lastSeq: number;
  hasMore: boolean;
}

/* ------------------------------------------------------------------ *
 * Live-only (non-persisted) frames
 * ------------------------------------------------------------------ */

export interface StreamReadyFrame {
  discussionId: string;
  status: DiscussionStatus;
  fromSeq: number;
  lastSeq: number;
  retryMs?: number;
}

export interface StreamCaughtUpFrame {
  discussionId: string;
  lastSeq: number;
}

export interface MessageDeltaFrame {
  discussionId?: string;
  messageId: string;
  speakerId: string;
  turnIndex?: number;
  delta: string;
}

export interface ErrorFrame {
  discussionId?: string;
  code: string;
  message: string;
  recoverable: boolean;
  requestId?: string;
}

export type LiveFrameType = Extract<
  SseEventType,
  "stream.ready" | "stream.caught_up" | "message.delta" | "error"
>;

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId?: string;
}
