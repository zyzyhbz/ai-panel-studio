import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, sleep, type TestApp } from "./helpers/app";

let current: TestApp | null = null;

afterEach(async () => {
  if (current) {
    await current.dispose();
    current = null;
  }
});

interface EventRow {
  id: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

async function startDiscussion(app: TestApp, expertCount = 3): Promise<string> {
  const created = await app.app.inject({
    method: "POST",
    url: "/api/discussions",
    payload: {
      topic: "开源模型会终结闭源大模型的商业模式吗？",
      expertCount,
      clientRequestId: randomUUID(),
    },
  });
  const id = (created.json() as { discussion: { id: string } }).discussion.id;
  await app.app.inject({ method: "POST", url: `/api/discussions/${id}/confirm` });
  return id;
}

async function waitEnded(app: TestApp, id: string, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const res = await app.app.inject({ method: "GET", url: `/api/discussions/${id}` });
    const body = res.json() as { discussion: { status: string } };
    if (body.discussion.status === "ended") return;
    if (body.discussion.status === "failed") throw new Error("discussion failed");
    await sleep(40);
  }
  throw new Error("did not end in time");
}

/** Persisted events for one discussion (ascending seq). */
async function events(app: TestApp, id: string): Promise<EventRow[]> {
  const res = await app.app.inject({
    method: "GET",
    url: `/api/discussions/${id}/events?after=0&limit=1000`,
  });
  return (res.json() as { items: EventRow[] }).items;
}

describe("event sequence invariants", () => {
  it("keeps seq contiguous and closes every turn", async () => {
    current = await createTestApp();
    const id = await startDiscussion(current, 3);
    await waitEnded(current, id);

    const res = await current.app.inject({
      method: "GET",
      url: `/api/discussions/${id}/events?after=0&limit=1000`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: EventRow[]; lastSeq: number; hasMore: boolean };
    const events = body.items;

    // 1) seq starts at 1 and is contiguous.
    expect(events[0]?.seq).toBe(1);
    events.forEach((event, index) => {
      expect(event.seq).toBe(index + 1);
    });
    expect(body.lastSeq).toBe(events.length);
    expect(body.hasMore).toBe(false);

    // 2) roster.ready is first and carries 1 host + N experts with unique colors.
    expect(events[0]?.type).toBe("roster.ready");
    const roster = events[0]?.payload.experts as { role: string; color: string }[];
    expect(roster.filter((e) => e.role === "host")).toHaveLength(1);
    expect(new Set(roster.map((e) => e.color)).size).toBe(roster.length);

    // 3) exactly one discussion.started, and it follows roster.ready.
    const startedIndexes = events
      .map((event, index) => (event.type === "discussion.started" ? index : -1))
      .filter((index) => index >= 0);
    expect(startedIndexes).toHaveLength(1);
    expect(startedIndexes[0]).toBe(1);

    // 4) every turn.started is closed by message.completed or turn.aborted.
    const open = new Set<string>();
    for (const event of events) {
      if (event.type === "turn.started") {
        const messageId = String(event.payload.messageId ?? "");
        expect(messageId).not.toBe("");
        expect(open.has(messageId)).toBe(false);
        open.add(messageId);
      } else if (event.type === "message.completed") {
        const message = event.payload.message as { id: string };
        expect(open.has(message.id)).toBe(true);
        open.delete(message.id);
      } else if (event.type === "turn.aborted") {
        const messageId = String(event.payload.messageId ?? "");
        expect(open.has(messageId)).toBe(true);
        open.delete(messageId);
      }
    }
    expect([...open]).toEqual([]);

    // 5) turnIndex is 1..turnCount and matches message.turnIndex.
    const completed = events
      .filter((event) => event.type === "message.completed")
      .map((event) => (event.payload.message as { turnIndex: number }).turnIndex);
    expect(completed).toEqual(completed.map((_, index) => index + 1));

    // 6) lifecycle order: summarizing -> summary.completed -> ended (last).
    const indexOf = (type: string): number => events.findIndex((event) => event.type === type);
    const summarizingAt = indexOf("discussion.summarizing");
    const summaryAt = indexOf("summary.completed");
    const endedAt = indexOf("discussion.ended");
    expect(summarizingAt).toBeGreaterThan(0);
    expect(summaryAt).toBeGreaterThan(summarizingAt);
    expect(endedAt).toBeGreaterThan(summaryAt);
    expect(endedAt).toBe(events.length - 1);

    // 7) no insight.updated after the terminal event.
    const insightIndexes = events
      .map((event, index) => (event.type === "insight.updated" ? index : -1))
      .filter((index) => index >= 0);
    for (const index of insightIndexes) expect(index).toBeLessThan(endedAt);
  }, 60_000);

  it("lets the in-flight utterance finish inside the /end grace window", async () => {
    current = await createTestApp({
      config: {
        session: { endGraceMs: 3_000 },
        mock: { delayMs: 40 },
        llm: { timeouts: { speech: 5_000, decision: 2_000, insight: 1_000, summary: 2_000 } },
      },
    });
    const app = current;
    const created = await app.app.inject({
      method: "POST",
      url: "/api/discussions",
      payload: {
        topic: "公司应该禁止员工用 AI 写代码吗？",
        expertCount: 3,
        clientRequestId: randomUUID(),
      },
    });
    const id = (created.json() as { discussion: { id: string } }).discussion.id;
    await app.app.inject({ method: "POST", url: `/api/discussions/${id}/confirm` });
    // 40ms per delta × ~7 deltas = one utterance is still streaming at 200ms.
    await sleep(200);
    const end = await app.app.inject({ method: "POST", url: `/api/discussions/${id}/end` });
    expect(end.statusCode).toBe(202);

    const startedAt = Date.now();
    let detail: {
      discussion: { status: string };
      messages: { content: string }[];
    } = { discussion: { status: "live" }, messages: [] };
    while (Date.now() - startedAt < 20_000) {
      const res = await app.app.inject({ method: "GET", url: `/api/discussions/${id}` });
      detail = res.json() as typeof detail;
      if (detail.discussion.status === "ended") break;
      await sleep(40);
    }
    expect(detail.discussion.status).toBe("ended");
    // The utterance finished instead of being cut: exactly one completed message and
    // no aborted turn.
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]?.content.length ?? 0).toBeGreaterThan(0);
    const rows = await events(app, id);
    expect(rows.filter((e) => e.type === "turn.aborted")).toHaveLength(0);
    expect(rows.at(-1)?.type).toBe("discussion.ended");
  }, 40_000);

  it("aborts the in-flight turn immediately when the grace window is zero", async () => {
    current = await createTestApp({
      config: {
        session: { endGraceMs: 0 },
        mock: { delayMs: 40 },
        llm: { timeouts: { speech: 5_000, decision: 2_000, insight: 1_000, summary: 2_000 } },
      },
    });
    const app = current;
    const created = await app.app.inject({
      method: "POST",
      url: "/api/discussions",
      payload: {
        topic: "开源模型会终结闭源大模型的商业模式吗？",
        expertCount: 3,
        clientRequestId: randomUUID(),
      },
    });
    const id = (created.json() as { discussion: { id: string } }).discussion.id;
    await app.app.inject({ method: "POST", url: `/api/discussions/${id}/confirm` });
    await sleep(200);
    await app.app.inject({ method: "POST", url: `/api/discussions/${id}/end` });

    const startedAt = Date.now();
    while (Date.now() - startedAt < 20_000) {
      const res = await app.app.inject({ method: "GET", url: `/api/discussions/${id}` });
      const status = (res.json() as { discussion: { status: string } }).discussion.status;
      if (status === "ended") break;
      await sleep(40);
    }
    const rows = await events(app, id);
    expect(rows.filter((e) => e.type === "turn.aborted").length).toBeGreaterThan(0);
    expect(rows.at(-1)?.type).toBe("discussion.ended");
  }, 40_000);

  it("emits turn.aborted under a timeout scenario and still finishes", async () => {
    current = await createTestApp({
      config: {
        llm: { timeouts: { roster: 1_500, decision: 120, speech: 150, insight: 200, summary: 400 } },
      },
    });
    const created = await current.app.inject({
      method: "POST",
      url: "/api/discussions",
      payload: {
        topic: "公司应该禁止员工用 AI 写代码吗？",
        expertCount: 3,
        clientRequestId: randomUUID(),
      },
      headers: { "x-qa-scenario": "timeout" },
    });
    const id = (created.json() as { discussion: { id: string } }).discussion.id;
    await current.app.inject({ method: "POST", url: `/api/discussions/${id}/confirm` });

    const startedAt = Date.now();
    while (Date.now() - startedAt < 30_000) {
      const res = await current.app.inject({ method: "GET", url: `/api/discussions/${id}` });
      const status = (res.json() as { discussion: { status: string } }).discussion.status;
      if (status === "ended") break;
      await sleep(50);
    }

    const events = (
      await current.app.inject({
        method: "GET",
        url: `/api/discussions/${id}/events?after=0&limit=1000`,
      })
    ).json() as { items: EventRow[] };
    const aborted = events.items.filter((e) => e.type === "turn.aborted");
    expect(aborted.length).toBeGreaterThan(0);
    expect(aborted[0]?.payload.reason).toBe("llm_timeout");

    const detail = (
      await current.app.inject({ method: "GET", url: `/api/discussions/${id}` })
    ).json() as {
      discussion: { status: string; turnCount: number };
      messages: { degraded: boolean }[];
    };
    expect(detail.discussion.status).toBe("ended");
    expect(detail.discussion.turnCount).toBeGreaterThanOrEqual(8);
    expect(detail.discussion.turnCount).toBeLessThanOrEqual(36);
    // The degraded retry guarantees visible content even when the model dies.
    expect(detail.messages.some((m) => m.degraded)).toBe(true);
  }, 90_000);
});
