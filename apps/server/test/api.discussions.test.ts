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

async function newApp(): Promise<TestApp> {
  current = await createTestApp();
  return current;
}

async function post(app: TestApp, url: string, payload?: unknown) {
  return app.app.inject({ method: "POST", url, payload: payload as never });
}

async function get(app: TestApp, url: string) {
  return app.app.inject({ method: "GET", url });
}

async function createDiscussion(
  app: TestApp,
  options: { topic?: string; expertCount?: number; clientRequestId?: string } = {},
) {
  return post(app, "/api/discussions", {
    topic: options.topic ?? "AI 会不会让初级开发者失业？",
    expertCount: options.expertCount ?? 3,
    clientRequestId: options.clientRequestId ?? randomUUID(),
  });
}

async function waitEnded(app: TestApp, id: string, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const res = await get(app, `/api/discussions/${id}`);
    const body = res.json() as {
      discussion: { status: string; turnCount: number };
      messages: unknown[];
      insights: unknown[];
      summary: { content: string } | null;
    };
    if (body.discussion.status === "ended") return body;
    await sleep(40);
  }
  throw new Error(`discussion ${id} did not end within ${timeoutMs}ms`);
}

describe("health", () => {
  it("reports dbReady, llmMode and no-store caching", async () => {
    const app = await newApp();
    const res = await get(app, "/api/health");
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.dbReady).toBe(true);
    expect(body.llmMode).toBe("mock");
    expect(typeof body.activeSseCount).toBe("number");
    expect(typeof body.rssBytes).toBe("number");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });
});

describe("create → detail → confirm → end", () => {
  it("runs the full main chain under mock LLM", async () => {
    const app = await newApp();

    const created = await createDiscussion(app, { expertCount: 3 });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json() as {
      discussion: { id: string; status: string; plannedTurns: number; expertCount: number };
      experts: { id: string; role: string; color: string; name: string }[];
    };
    expect(createdBody.discussion.status).toBe("ready");
    expect(createdBody.discussion.plannedTurns).toBe(10);
    expect(createdBody.experts).toHaveLength(4);
    expect(createdBody.experts.filter((e) => e.role === "host")).toHaveLength(1);
    expect(new Set(createdBody.experts.map((e) => e.color)).size).toBe(4);
    expect(new Set(createdBody.experts.map((e) => e.name)).size).toBe(4);

    const id = createdBody.discussion.id;

    const detail = await get(app, `/api/discussions/${id}`);
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as {
      experts: unknown[];
      messages: unknown[];
      insights: unknown[];
      summary: unknown;
      activeTurn: unknown;
    };
    expect(detailBody.experts).toHaveLength(4);
    expect(detailBody.messages).toHaveLength(0);
    expect(detailBody.summary).toBeNull();
    expect(detailBody.activeTurn).toBeNull();

    const confirmed = await post(app, `/api/discussions/${id}/confirm`);
    expect(confirmed.statusCode).toBe(202);
    expect((confirmed.json() as { discussion: { status: string } }).discussion.status).toBe("live");

    // Idempotent confirm: no second runner, no duplicate discussion.started.
    const again = await post(app, `/api/discussions/${id}/confirm`);
    expect(again.statusCode).toBe(200);
    expect((again.json() as { restarted: boolean }).restarted).toBe(false);

    const ended = await waitEnded(app, id);
    expect(ended.discussion.turnCount).toBe(10);
    expect(ended.messages).toHaveLength(10);
    expect(ended.summary?.content.length ?? 0).toBeGreaterThan(20);
    // The consensus/divergence panel must not be empty after a full session.
    expect(ended.insights.length).toBeGreaterThan(0);

    // End is idempotent after the session is over.
    const endAgain = await post(app, `/api/discussions/${id}/end`);
    expect(endAgain.statusCode).toBe(200);
    expect((endAgain.json() as { accepted: boolean }).accepted).toBe(false);

    // /state replays the same log the live path wrote.
    const state = await get(app, `/api/discussions/${id}/state`);
    expect(state.statusCode).toBe(200);
    const stateBody = state.json() as {
      status: string;
      turnCount: number;
      messages: { id: string; content: string }[];
      summary: { content: string } | null;
    };
    expect(stateBody.status).toBe("ended");
    expect(stateBody.turnCount).toBe(10);
    expect(stateBody.messages.map((m) => m.id)).toEqual(
      (ended.messages as { id: string }[]).map((m) => m.id),
    );
    expect(stateBody.summary?.content).toBe(ended.summary?.content);

    const list = await get(app, "/api/discussions?status=ended");
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { items: { id: string }[]; total: number };
    expect(listBody.items.some((item) => item.id === id)).toBe(true);
  }, 60_000);

  it("is idempotent on clientRequestId", async () => {
    const app = await newApp();
    const clientRequestId = randomUUID();
    const first = await createDiscussion(app, { clientRequestId });
    const second = await createDiscussion(app, { clientRequestId });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    const firstBody = first.json() as { discussion: { id: string } };
    const secondBody = second.json() as { discussion: { id: string } };
    expect(secondBody.discussion.id).toBe(firstBody.discussion.id);

    const list = await get(app, "/api/discussions?status=active");
    expect((list.json() as { total: number }).total).toBe(1);
  });

  it("validates input and unknown ids", async () => {
    const app = await newApp();

    const shortTopic = await post(app, "/api/discussions", {
      topic: "a",
      expertCount: 3,
      clientRequestId: randomUUID(),
    });
    expect(shortTopic.statusCode).toBe(400);
    expect((shortTopic.json() as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");

    const badCount = await post(app, "/api/discussions", {
      topic: "这是一个合法长度的议题",
      expertCount: 7,
      clientRequestId: randomUUID(),
    });
    expect(badCount.statusCode).toBe(400);

    const noRequestId = await post(app, "/api/discussions", {
      topic: "这是一个合法长度的议题",
      expertCount: 3,
    });
    expect(noRequestId.statusCode).toBe(400);

    const missing = await get(app, `/api/discussions/${randomUUID()}`);
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { error: { code: string } }).error.code).toBe("NOT_FOUND");

    const badStatus = await get(app, "/api/discussions?status=nonsense");
    expect(badStatus.statusCode).toBe(400);
  });

  it("rejects regenerate once the discussion is live", async () => {
    const app = await newApp();
    const created = await createDiscussion(app);
    const id = (created.json() as { discussion: { id: string } }).discussion.id;
    await post(app, `/api/discussions/${id}/confirm`);

    const regen = await post(app, `/api/discussions/${id}/roster/regenerate`);
    expect(regen.statusCode).toBe(409);
    expect((regen.json() as { error: { code: string } }).error.code).toBe("INVALID_STATE");
  });

  it("rejects end for a discussion that never started", async () => {
    const app = await newApp();
    const created = await createDiscussion(app);
    const id = (created.json() as { discussion: { id: string } }).discussion.id;
    const end = await post(app, `/api/discussions/${id}/end`);
    expect(end.statusCode).toBe(409);
  });
});
