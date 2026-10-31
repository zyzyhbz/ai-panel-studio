import type { DiscussionStatus } from "@ai-panel/shared";
import type { StoredEventRecord } from "../types";
import type {
  ActiveTurnDto,
  ExpertDto,
  InsightDto,
  MessageDto,
  SummaryDto,
} from "../http/serializers";

export interface ReplayState {
  status: DiscussionStatus;
  turnCount: number;
  lastSeq: number;
  experts: ExpertDto[];
  messages: MessageDto[];
  insights: InsightDto[];
  summary: SummaryDto | null;
  activeTurn: ActiveTurnDto | null;
  errorCode: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

/**
 * The single reducer used by GET /state (and by tests) to prove
 * "live final state === replay final state".
 *
 * It consumes persisted events only — never token deltas — and every branch is
 * driven by the event payload exactly as it was sent over SSE.
 */
export function replayEvents(
  events: readonly StoredEventRecord[],
  initialStatus: DiscussionStatus,
): ReplayState {
  const state: ReplayState = {
    status: initialStatus,
    turnCount: 0,
    lastSeq: 0,
    experts: [],
    messages: [],
    insights: [],
    summary: null,
    activeTurn: null,
    errorCode: null,
    startedAt: null,
    endedAt: null,
  };

  for (const event of events) {
    state.lastSeq = event.seq;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(event.payloadJson) as Record<string, unknown>;
    } catch {
      continue;
    }

    switch (event.type) {
      case "roster.ready": {
        const experts = payload.experts;
        if (Array.isArray(experts)) state.experts = experts as ExpertDto[];
        break;
      }
      case "discussion.started": {
        state.status = "live";
        if (typeof payload.startedAt === "string") state.startedAt = payload.startedAt;
        break;
      }
      case "discussion.summarizing": {
        state.status = "summarizing";
        break;
      }
      case "turn.started": {
        state.activeTurn = {
          turnIndex: Number(payload.turnIndex ?? 0),
          speakerId: String(payload.speakerId ?? ""),
          messageId: String(payload.messageId ?? ""),
          intent: payload.intent as ActiveTurnDto["intent"],
          turnFocus: String(payload.turnFocus ?? ""),
          references: Array.isArray(payload.references)
            ? (payload.references as string[])
            : [],
        };
        break;
      }
      case "message.completed": {
        const message = payload.message as MessageDto | undefined;
        if (message && typeof message.id === "string") {
          if (!state.messages.some((m) => m.id === message.id)) {
            state.messages.push(message);
            state.turnCount += 1;
          }
          if (state.activeTurn && state.activeTurn.messageId === message.id) {
            state.activeTurn = null;
          }
        }
        break;
      }
      case "turn.aborted": {
        const messageId = payload.messageId;
        if (state.activeTurn && (messageId ? state.activeTurn.messageId === messageId : true)) {
          state.activeTurn = null;
        }
        break;
      }
      case "insight.updated": {
        const insights = payload.insights;
        if (Array.isArray(insights)) state.insights = insights as InsightDto[];
        break;
      }
      case "summary.completed": {
        const summary = payload.summary as SummaryDto | null | undefined;
        state.summary = summary && typeof summary.content === "string" ? summary : null;
        break;
      }
      case "discussion.ended": {
        state.status = "ended";
        if (typeof payload.endedAt === "string") state.endedAt = payload.endedAt;
        state.activeTurn = null;
        break;
      }
      case "discussion.failed": {
        state.status = "failed";
        if (typeof payload.code === "string") state.errorCode = payload.code;
        if (typeof payload.failedAt === "string") state.endedAt = payload.failedAt;
        state.activeTurn = null;
        break;
      }
      default:
        break;
    }
  }

  return state;
}

/** Derive the in-flight turn from the log: last turn.started not yet closed. */
export function computeActiveTurn(events: readonly StoredEventRecord[]): ActiveTurnDto | null {
  let active: ActiveTurnDto | null = null;
  for (const event of events) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(event.payloadJson) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type === "turn.started") {
      active = {
        turnIndex: Number(payload.turnIndex ?? 0),
        speakerId: String(payload.speakerId ?? ""),
        messageId: String(payload.messageId ?? ""),
        intent: payload.intent as ActiveTurnDto["intent"],
        turnFocus: String(payload.turnFocus ?? ""),
        references: Array.isArray(payload.references) ? (payload.references as string[]) : [],
      };
    } else if (event.type === "message.completed") {
      const message = payload.message as { id?: string } | undefined;
      if (active && message?.id === active.messageId) active = null;
    } else if (event.type === "turn.aborted") {
      if (active && (!payload.messageId || payload.messageId === active.messageId)) {
        active = null;
      }
    } else if (event.type === "discussion.ended" || event.type === "discussion.failed") {
      active = null;
    }
  }
  return active;
}
