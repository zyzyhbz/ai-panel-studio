export const APP_NAME = "AI Panel Studio";

export const DISCUSSION_STATUSES = [
  "generating",
  "ready",
  "live",
  "summarizing",
  "ended",
  "failed",
] as const;

export type DiscussionStatus = (typeof DISCUSSION_STATUSES)[number];

export const EXPERT_ROLES = ["host", "expert"] as const;
export type ExpertRole = (typeof EXPERT_ROLES)[number];

export const INTENTS = [
  "opening",
  "probe",
  "rebut",
  "support",
  "extend",
  "clarify",
  "mediate",
  "redirect",
  "summary",
] as const;

export type Intent = (typeof INTENTS)[number];

export const HOST_INTENTS: readonly Intent[] = [
  "opening",
  "probe",
  "mediate",
  "redirect",
  "summary",
];

export const EXPERT_INTENTS: readonly Intent[] = [
  "rebut",
  "support",
  "extend",
  "clarify",
];

export const POLARITIES = [
  "strong_oppose",
  "oppose",
  "neutral",
  "support",
  "strong_support",
] as const;

export type Polarity = (typeof POLARITIES)[number];

export const INSIGHT_TYPES = [
  "consensus",
  "divergence",
  "open_question",
] as const;

export type InsightType = (typeof INSIGHT_TYPES)[number];

export const TURN_ABORT_REASONS = [
  "user_end",
  "llm_timeout",
  "invalid_output",
  "empty_output",
  "guard_rejected",
  "interrupted",
  "watchdog",
] as const;

export type TurnAbortReason = (typeof TURN_ABORT_REASONS)[number];

export const SSE_EVENT_TYPES = [
  "stream.ready",
  "stream.caught_up",
  "roster.ready",
  "discussion.started",
  "discussion.summarizing",
  "turn.started",
  "message.delta",
  "message.completed",
  "turn.aborted",
  "insight.updated",
  "summary.completed",
  "discussion.ended",
  "discussion.failed",
  "error",
] as const;

export type SseEventType = (typeof SSE_EVENT_TYPES)[number];

export const PERSISTED_EVENT_TYPES = [
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
] as const;

export type PersistedEventType = (typeof PERSISTED_EVENT_TYPES)[number];

export function plannedTurnsFor(expertCount: number): number {
  const n = Math.min(6, Math.max(3, Math.trunc(expertCount)));
  return Math.min(12, Math.max(8, 4 + 2 * n));
}

export function maxTurnsFor(expertCount: number): number {
  return Math.min(14, plannedTurnsFor(expertCount) + 2);
}
