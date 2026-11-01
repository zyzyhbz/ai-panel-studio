import { describe, expect, it } from "vitest";

import { applyEvent, reduceEvents, sessionReducer } from "./reducer";
import { emptySession, hydrateFromDetail } from "./session";
import { makeDetail, makeEvents, makeInsight, makeMessage } from "../test/fixtures";

const ID = "d_01";

describe("sessionReducer", () => {
  it("rebuilds the same projection from events as from the REST snapshot (I1)", () => {
    const base = makeDetail();
    const endedDetail = {
      ...base,
      discussion: {
        ...base.discussion,
        status: "ended" as const,
        endedAt: "2026-11-01T10:00:46.000Z",
      },
      messages: [makeMessage()],
      insights: [makeInsight()],
      summary: {
        content: "这场讨论的共识是……主要分歧在……",
        createdAt: "2026-11-01T10:00:45.000Z",
        isFallback: false,
      },
    };

    const fromEvents = reduceEvents(emptySession(ID), makeEvents());
    const fromRest = hydrateFromDetail(emptySession(ID), endedDetail);

    expect(fromEvents.status).toBe(fromRest.status);
    expect(fromEvents.messages.map((m) => m.id)).toEqual(
      fromRest.messages.map((m) => m.id),
    );
    expect(fromEvents.insights.map((i) => i.id)).toEqual(
      fromRest.insights.map((i) => i.id),
    );
    expect(fromEvents.summary?.content).toBe(fromRest.summary?.content);
    expect(fromEvents.roster.map((e) => e.id)).toEqual(
      fromRest.roster.map((e) => e.id),
    );
  });

  it("is idempotent: a replayed seq must not change state or identity (I2)", () => {
    const events = makeEvents();
    const once = reduceEvents(emptySession(ID), events);
    const twice = reduceEvents(once, events);
    expect(twice).toBe(once);
  });

  it("keeps transcript order even when events arrive out of order (I4)", () => {
    const turn2 = makeMessage({
      id: "m_02",
      expertId: "e_01",
      speakerName: "周明",
      speakerColor: "#E8B04B",
      turnIndex: 2,
      content: "第二条",
      createdAt: "2026-11-01T10:00:20.000Z",
    });
    const turn1 = makeMessage({ id: "m_01", turnIndex: 1 });

    let view = emptySession(ID);
    view = applyEvent(view, {
      seq: 1,
      type: "message.completed",
      createdAt: "2026-11-01T10:00:21.000Z",
      payload: { discussionId: ID, message: turn2 },
    });
    view = applyEvent(view, {
      seq: 2,
      type: "message.completed",
      createdAt: "2026-11-01T10:00:22.000Z",
      payload: { discussionId: ID, message: turn1 },
    });

    expect(view.messages.map((m) => m.turnIndex)).toEqual([1, 2]);
  });

  it("clears a pending turn on turn.aborted and records a readable notice", () => {
    const view = reduceEvents(emptySession(ID), makeEvents());
    expect(view.activeTurn).toBeNull();
    const notice = view.notices.find((n) => n.turnIndex === 2);
    expect(notice?.reason).toBe("llm_timeout");
    expect(notice?.speakerName).toBe("周明");
    // aborted turns never count as turns
    expect(view.turnCount).toBe(1);
  });

  it("treats discussion.failed as a terminal state with a readable failure", () => {
    const view = reduceEvents(emptySession(ID), [
      {
        seq: 1,
        type: "discussion.started",
        createdAt: "2026-11-01T10:00:00.000Z",
        payload: { discussionId: ID, startedAt: "2026-11-01T10:00:00.000Z" },
      },
      {
        seq: 2,
        type: "discussion.failed",
        createdAt: "2026-11-01T10:00:05.000Z",
        payload: {
          discussionId: ID,
          code: "LLM_TIMEOUT",
          message: "服务暂时不可用",
          retryable: false,
          failedAt: "2026-11-01T10:00:05.000Z",
        },
      },
    ]);

    expect(view.status).toBe("failed");
    expect(view.failure).toEqual({
      code: "LLM_TIMEOUT",
      message: "服务暂时不可用",
      retryable: false,
    });
  });

  it("moves through summarizing before ended", () => {
    let view = emptySession(ID);
    view = sessionReducer(view, { type: "localStatus", status: "summarizing" });
    expect(view.status).toBe("summarizing");

    view = applyEvent(view, {
      seq: 1,
      type: "discussion.ended",
      createdAt: "2026-11-01T10:01:00.000Z",
      payload: { discussionId: ID, endedAt: "2026-11-01T10:01:00.000Z" },
    });
    expect(view.status).toBe("ended");
  });
});
