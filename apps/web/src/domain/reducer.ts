import type { Expert, PersistedEvent } from "../api/types";
import {
  emptySession,
  hydrateFromDetail,
  hydrateFromState,
  insertMessage,
  type SessionView,
  type TurnNotice,
} from "./session";
import type { DiscussionDetail, DiscussionState } from "../api/types";

export type SessionAction =
  | { type: "hydrate"; detail: DiscussionDetail }
  | { type: "hydrateState"; state: DiscussionState }
  | { type: "event"; event: PersistedEvent }
  | { type: "localStatus"; status: SessionView["status"] }
  | { type: "localFailure"; failure: NonNullable<SessionView["failure"]> }
  | { type: "reset"; discussionId: string; topic?: string };

function speakerName(roster: Expert[], speakerId: string): string | null {
  return roster.find((e) => e.id === speakerId)?.name ?? null;
}

function noticeOf(view: SessionView, payload: {
  turnIndex: number;
  speakerId: string;
  reason: string;
}, at: string): TurnNotice {
  return {
    turnIndex: payload.turnIndex,
    speakerId: payload.speakerId,
    speakerName: speakerName(view.roster, payload.speakerId),
    reason: payload.reason,
    at,
  };
}

/**
 * Pure, order-tolerant, idempotent projection.
 *
 * I2 idempotent: seq <= lastSeq is a no-op (returns the same reference).
 * I3 monotonic: lastSeq never decreases.
 * I4 order-independent: messages are keyed by id and sorted by turnIndex.
 * I5 pure: no Date.now(), no window, no id generation.
 */
export function applyEvent(view: SessionView, event: PersistedEvent): SessionView {
  if (event.seq <= view.lastSeq) return view;

  const base: SessionView = { ...view, lastSeq: event.seq };

  switch (event.type) {
    case "roster.ready": {
      const experts = event.payload.experts ?? [];
      return {
        ...base,
        roster: experts.length > 0 ? experts : base.roster,
        expertCount: experts.length > 0 ? experts.length : base.expertCount,
      };
    }

    case "discussion.started":
      return {
        ...base,
        status: "live",
        startedAt: event.payload.startedAt ?? base.startedAt,
      };

    case "discussion.summarizing":
      return {
        ...base,
        status: "summarizing",
        activeTurn: null,
        turnStartedAt: null,
        summarizing: {
          reason: event.payload.reason === "auto" ? "auto" : "user",
          startedAt: event.payload.startedAt ?? event.createdAt,
        },
      };

    case "turn.started": {
      const p = event.payload;
      return {
        ...base,
        activeTurn: {
          turnIndex: p.turnIndex,
          speakerId: p.speakerId,
          messageId: p.messageId,
          intent: p.intent,
          turnFocus: p.turnFocus ?? "",
          references: p.references,
        },
        turnStartedAt: event.createdAt,
      };
    }

    case "message.completed": {
      const message = event.payload.message;
      if (!message) return base;
      const sameTurn =
        base.activeTurn && base.activeTurn.messageId === message.id
          ? null
          : base.activeTurn;
      return {
        ...base,
        messages: insertMessage(base.messages, message),
        activeTurn: sameTurn,
        turnStartedAt: sameTurn ? base.turnStartedAt : null,
        turnCount: Math.max(base.turnCount, message.turnIndex),
      };
    }

    case "turn.aborted": {
      const p = event.payload;
      const clearActive =
        base.activeTurn &&
        (base.activeTurn.turnIndex === p.turnIndex ||
          (p.messageId ? base.activeTurn.messageId === p.messageId : false))
          ? null
          : base.activeTurn;
      return {
        ...base,
        activeTurn: clearActive,
        turnStartedAt: clearActive ? base.turnStartedAt : null,
        notices: [
          ...base.notices,
          noticeOf(base, p, event.createdAt),
        ],
      };
    }

    case "insight.updated":
      return { ...base, insights: event.payload.insights ?? [] };

    case "summary.completed":
      return {
        ...base,
        summary: event.payload.summary ?? null,
        activeTurn: null,
      };

    case "discussion.ended":
      return {
        ...base,
        status: "ended",
        endedAt: event.payload.endedAt ?? event.createdAt,
        activeTurn: null,
        turnStartedAt: null,
      };

    case "discussion.failed": {
      const p = event.payload;
      return {
        ...base,
        status: "failed",
        activeTurn: null,
        turnStartedAt: null,
        failure: {
          code: p.code ?? "INTERNAL",
          message: p.message ?? "这场讨论中断了。",
          retryable: p.retryable ?? false,
        },
      };
    }

    default:
      return base;
  }
}

export function reduceEvents(
  view: SessionView,
  events: readonly PersistedEvent[],
): SessionView {
  return events.reduce(applyEvent, view);
}

export function sessionReducer(
  view: SessionView,
  action: SessionAction,
): SessionView {
  switch (action.type) {
    case "hydrate":
      return hydrateFromDetail(view, action.detail);
    case "hydrateState":
      return hydrateFromState(view, action.state);
    case "event":
      return applyEvent(view, action.event);
    case "localStatus":
      return {
        ...view,
        status: action.status,
        activeTurn:
          action.status === "summarizing" || action.status === "ended"
            ? null
            : view.activeTurn,
        turnStartedAt:
          action.status === "summarizing" || action.status === "ended"
            ? null
            : view.turnStartedAt,
      };
    case "localFailure":
      return {
        ...view,
        status: "failed",
        activeTurn: null,
        turnStartedAt: null,
        failure: action.failure,
      };
    case "reset":
      return {
        ...emptySession(action.discussionId),
        topic: action.topic ?? "",
      };
    default:
      return view;
  }
}
