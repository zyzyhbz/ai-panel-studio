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
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

async function create(app: TestApp, topic: string): Promise<string> {
  const res = await app.app.inject({
    method: "POST",
    url: "/api/discussions",
    payload: { topic, expertCount: 3, clientRequestId: randomUUID() },
  });
  return (res.json() as { discussion: { id: string } }).discussion.id;
}

async function waitEnded(app: TestApp, id: string, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const res = await app.app.inject({ method: "GET", url: `/api/discussions/${id}` });
    const status = (res.json() as { discussion: { status: string } }).discussion.status;
    if (status === "ended") return;
    await sleep(40);
  }
  throw new Error(`discussion ${id} did not end`);
}

async function events(app: TestApp, id: string): Promise<EventRow[]> {
  const res = await app.app.inject({
    method: "GET",
    url: `/api/discussions/${id}/events?after=0&limit=1000`,
  });
  return (res.json() as { items: EventRow[] }).items;
}

describe("multi-session isolation", () => {
  it("keeps two concurrent discussions fully separated", async () => {
    current = await createTestApp();
    const app = current;

    const idA = await create(app, "AI 会不会让初级开发者失业？");
    const idB = await create(app, "远程办公应该成为默认选项吗？");
    expect(idA).not.toBe(idB);

    await app.app.inject({ method: "POST", url: `/api/discussions/${idA}/confirm` });
    await app.app.inject({ method: "POST", url: `/api/discussions/${idB}/confirm` });

    await waitEnded(app, idA);
    await waitEnded(app, idB);

    const eventsA = await events(app, idA);
    const eventsB = await events(app, idB);

    // Each stream only ever mentions its own discussionId.
    for (const event of eventsA) expect(event.payload.discussionId).toBe(idA);
    for (const event of eventsB) expect(event.payload.discussionId).toBe(idB);

    // seq is per-session and contiguous in both.
    expect(eventsA.map((e) => e.seq)).toEqual(eventsA.map((_, i) => i + 1));
    expect(eventsB.map((e) => e.seq)).toEqual(eventsB.map((_, i) => i + 1));

    // No message id is shared between sessions.
    const messageIds = (rows: EventRow[]): string[] =>
      rows
        .filter((e) => e.type === "message.completed")
        .map((e) => (e.payload.message as { id: string }).id);
    const idsA = new Set(messageIds(eventsA));
    const idsB = messageIds(eventsB);
    expect(idsB.some((id) => idsA.has(id))).toBe(false);

    // Expert ids never collide across sessions (global PK safety).
    const expertIds = (rows: EventRow[]): string[] => {
      const roster = rows.find((e) => e.type === "roster.ready");
      const experts = (roster?.payload.experts ?? []) as { id: string }[];
      return experts.map((e) => e.id);
    };
    const expertsA = new Set(expertIds(eventsA));
    expect(expertIds(eventsB).some((id) => expertsA.has(id))).toBe(false);

    // Both reached their own final state.
    const detailA = (
      await app.app.inject({ method: "GET", url: `/api/discussions/${idA}` })
    ).json() as { discussion: { status: string; turnCount: number } };
    const detailB = (
      await app.app.inject({ method: "GET", url: `/api/discussions/${idB}` })
    ).json() as { discussion: { status: string; turnCount: number } };
    expect(detailA.discussion.status).toBe("ended");
    expect(detailB.discussion.status).toBe("ended");
    expect(detailA.discussion.turnCount).toBe(10);
    expect(detailB.discussion.turnCount).toBe(10);
  }, 60_000);

  it("keeps insight ids unique across discussions in the same database", async () => {
    // Regression: the agent numbers insight ids per session (`i_1`, `i_2`, …).
    // Using them as the global `insights.id` PK made the second discussion fail
    // with `UNIQUE constraint failed: insights.id`, which silently left the
    // consensus panel empty while every other assertion still passed.
    current = await createTestApp();
    const app = current;

    const ids: string[] = [];
    for (const topic of ["AI 会不会让初级开发者失业？", "远程办公应该成为默认选项吗？"]) {
      const id = await create(app, topic);
      await app.app.inject({ method: "POST", url: `/api/discussions/${id}/confirm` });
      ids.push(id);
    }
    for (const id of ids) await waitEnded(app, id);

    for (const id of ids) {
      const detail = (
        await app.app.inject({ method: "GET", url: `/api/discussions/${id}` })
      ).json() as { insights: { id: string; evidenceMessageIds: string[] }[] };
      expect(detail.insights.length).toBeGreaterThan(0);
      for (const insight of detail.insights) {
        expect(insight.id).toMatch(/^i_[0-9a-f]{24}$/);
        expect(insight.evidenceMessageIds.length).toBeGreaterThan(0);
      }
      const rows = await events(app, id);
      expect(rows.filter((e) => e.type === "insight.updated").length).toBeGreaterThan(0);
    }

    // Insight ids never collide across the two discussions.
    const a = (
      await app.app.inject({ method: "GET", url: `/api/discussions/${ids[0]}` })
    ).json() as { insights: { id: string }[] };
    const b = (
      await app.app.inject({ method: "GET", url: `/api/discussions/${ids[1]}` })
    ).json() as { insights: { id: string }[] };
    const setA = new Set(a.insights.map((i) => i.id));
    expect(b.insights.some((i) => setA.has(i.id))).toBe(false);
  }, 60_000);

  it("keeps the authored demo fixtures intact across boot recovery", async () => {
    current = await createTestApp({ seed: true });
    const app = current;
    const liveFixture = "d0000002-0000-4000-8000-000000000002";

    const before = (
      await app.app.inject({ method: "GET", url: `/api/discussions/${liveFixture}` })
    ).json() as { discussion: { status: string }; messages: unknown[]; insights: unknown[] };
    expect(before.discussion.status).toBe("live");
    expect(before.messages.length).toBeGreaterThan(0);
    expect(before.insights.length).toBeGreaterThan(0);

    const { recoverOnBoot } = await import("../src/session/recovery");
    const deps = {
      config: app.ctx.config,
      db: app.ctx.db,
      clock: app.ctx.clock,
      llm: app.ctx.llm,
      repos: app.ctx.repos,
      events: app.ctx.events,
      broadcaster: app.ctx.broadcaster,
      log: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      },
    };
    const report = recoverOnBoot(deps);
    expect(report.interrupted).toBe(0);

    const after = (
      await app.app.inject({ method: "GET", url: `/api/discussions/${liveFixture}` })
    ).json() as { discussion: { status: string } };
    expect(after.discussion.status).toBe("live");

    // A real (non-fixture) live session is still interrupted.
    const realId = await create(app, "公司应该禁止员工用 AI 写代码吗？");
    app.ctx.repos.discussions.casStatus(realId, ["ready"], "live", app.ctx.clock());
    expect(recoverOnBoot(deps).interrupted).toBe(1);
  }, 30_000);

  it("starts only one runner and one discussion.started on double confirm", async () => {
    current = await createTestApp();
    const app = current;
    const id = await create(app, "公司应该禁止员工用 AI 写代码吗？");

    const results = await Promise.all([
      app.app.inject({ method: "POST", url: `/api/discussions/${id}/confirm` }),
      app.app.inject({ method: "POST", url: `/api/discussions/${id}/confirm` }),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 202]);

    await waitEnded(app, id);
    const rows = await events(app, id);
    expect(rows.filter((e) => e.type === "discussion.started")).toHaveLength(1);
    // A single runner means no duplicated turn.started for the same turnIndex.
    const turnIndexes = rows
      .filter((e) => e.type === "turn.started")
      .map((e) => e.payload.turnIndex as number);
    expect(turnIndexes).toEqual(turnIndexes.map((_, i) => i + 1));
  }, 60_000);

  it("recovers live sessions as failed(INTERRUPTED) without re-running the model", async () => {
    current = await createTestApp();
    const app = current;
    const id = await create(app, "开源模型会终结闭源大模型的商业模式吗？");

    // Simulate the exact post-crash state: the row says `live`, but no runner
    // exists in this process (that is what boot recovery has to clean up).
    const started = app.ctx.repos.discussions.casStatus(
      id,
      ["ready"],
      "live",
      app.ctx.clock(),
      { startedAt: app.ctx.clock() },
    );
    expect(started).toBe(true);
    const llmCallsBefore = app.ctx.repos.events.countByDiscussion(id);

    const { recoverOnBoot } = await import("../src/session/recovery");
    const report = recoverOnBoot({
      config: app.ctx.config,
      db: app.ctx.db,
      clock: app.ctx.clock,
      llm: app.ctx.llm,
      repos: app.ctx.repos,
      events: app.ctx.events,
      broadcaster: app.ctx.broadcaster,
      log: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      },
    });
    expect(report.interrupted).toBe(1);

    const detail = (
      await app.app.inject({ method: "GET", url: `/api/discussions/${id}` })
    ).json() as { discussion: { status: string; errorCode: string } };
    expect(detail.discussion.status).toBe("failed");
    expect(detail.discussion.errorCode).toBe("INTERRUPTED");

    const rows = await events(app, id);
    expect(rows.filter((e) => e.type === "discussion.failed")).toHaveLength(1);
    expect(rows.at(-1)?.type).toBe("discussion.failed");
    // Recovery writes exactly one event and never calls the model again.
    expect(app.ctx.repos.events.countByDiscussion(id)).toBe(llmCallsBefore + 1);

    // Replaying the state still works for the failed session.
    const state = (
      await app.app.inject({ method: "GET", url: `/api/discussions/${id}/state` })
    ).json() as { status: string; messages: unknown[] };
    expect(state.status).toBe("failed");
    expect(state.messages).toHaveLength(0);

    // Recovery is idempotent: a second boot must not duplicate the terminal event.
    recoverOnBoot({
      config: app.ctx.config,
      db: app.ctx.db,
      clock: app.ctx.clock,
      llm: app.ctx.llm,
      repos: app.ctx.repos,
      events: app.ctx.events,
      broadcaster: app.ctx.broadcaster,
      log: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      },
    });
    const after = await events(app, id);
    expect(after.filter((e) => e.type === "discussion.failed")).toHaveLength(1);
  }, 30_000);
});
