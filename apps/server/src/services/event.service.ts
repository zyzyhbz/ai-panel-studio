import type { PersistedEventType } from "@ai-panel/shared";
import { AppError } from "../http/errors";
import type { Clock } from "../lib/clock";
import { newId } from "../lib/ids";
import type { DiscussionsRepo } from "../repositories/discussions.repo";
import type { EventsRepo } from "../repositories/events.repo";
import type { BroadcastFrame } from "../session/broadcaster";

export interface PersistedFrame extends BroadcastFrame {
  seq: number;
}

export interface EventSink {
  emitPersisted(discussionId: string, frame: PersistedFrame): void;
}

/** Event types that close a session. Nothing may follow them. */
export const TERMINAL_EVENTS: ReadonlySet<string> = new Set([
  "discussion.ended",
  "discussion.failed",
]);

export interface AppendResult<P> {
  seq: number;
  payloadJson: string;
  payload: P;
}

export interface EventService {
  append<P extends Record<string, unknown>>(input: {
    discussionId: string;
    type: PersistedEventType;
    payload: P;
    /** Required only for boot recovery, which writes the terminal event itself. */
    allowClosed?: boolean;
  }): AppendResult<P & { discussionId: string }>;
  lastSeq(discussionId: string): number;
}

/**
 * The ONLY writer of persisted events.
 *
 * Guarantees:
 * - `discussionId` is injected into the payload, so the stored JSON is exactly
 *   the SSE `data` object (replay/live share one shape).
 * - the stored string is what gets broadcast — one serialization, no drift.
 * - closed sessions reject writes (I5: nothing after the terminal event).
 *
 * Everything here is synchronous by design; see docs/BACKEND-PLAN.md §4.
 */
export function createEventService(deps: {
  clock: Clock;
  events: EventsRepo;
  discussions: DiscussionsRepo;
  sink?: EventSink;
}): EventService {
  const { clock, events, discussions, sink } = deps;

  return {
    append<P extends Record<string, unknown>>(input: {
      discussionId: string;
      type: PersistedEventType;
      payload: P;
      allowClosed?: boolean;
    }): AppendResult<P & { discussionId: string }> {
      const discussion = discussions.getById(input.discussionId);
      if (!discussion) throw new AppError("NOT_FOUND");

      if (!input.allowClosed && !TERMINAL_EVENTS.has(input.type)) {
        if (discussion.status === "ended") {
          throw new AppError("INVALID_STATE", "讨论已结束，不再产生新事件", {
            discussionId: discussion.id,
          });
        }
        if (discussion.status === "failed") {
          throw new AppError("INVALID_STATE", "讨论已中断，不再产生新事件", {
            discussionId: discussion.id,
          });
        }
      }

      const payload = { discussionId: input.discussionId, ...input.payload } as P & {
        discussionId: string;
      };
      const payloadJson = JSON.stringify(payload);
      const createdAt = clock();
      const { seq } = events.append({
        id: newId(),
        discussionId: input.discussionId,
        type: input.type,
        payloadJson,
        createdAt,
      });
      sink?.emitPersisted(input.discussionId, { seq, type: input.type, dataJson: payloadJson });
      return { seq, payloadJson, payload };
    },

    lastSeq(discussionId: string): number {
      return events.lastSeq(discussionId);
    },
  };
}
