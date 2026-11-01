import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./helpers/app";

interface Frame {
  id: number | null;
  event: string;
  data: string;
}

let current: TestApp | null = null;

afterEach(async () => {
  if (current) {
    await current.dispose();
    current = null;
  }
});

function parseBlock(block: string): Frame | null {
  const lines = block.split("\n");
  let id: number | null = null;
  let event = "";
  let data = "";
  let sawField = false;
  for (const line of lines) {
    if (line.startsWith(":") || line.length === 0) continue;
    if (line.startsWith("id:")) {
      id = Number.parseInt(line.slice(3).trim(), 10);
      sawField = true;
    } else if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      sawField = true;
    } else if (line.startsWith("data:")) {
      data += line.slice(5).trim();
      sawField = true;
    }
  }
  if (!sawField || !event) return null;
  return { id, event, data };
}

async function connectSse(
  baseUrl: string,
  path: string,
  options: { headers?: Record<string, string>; stopOn?: string[]; timeoutMs?: number } = {},
): Promise<{ status: number; frames: Frame[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  timer.unref?.();
  const frames: Frame[] = [];
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { accept: "text/event-stream", ...(options.headers ?? {}) },
      signal: controller.signal,
    });
    if (response.status !== 200) {
      return { status: response.status, frames };
    }
    if (!response.body) return { status: response.status, frames };
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const frame = parseBlock(block);
        if (frame) {
          frames.push(frame);
          if (options.stopOn?.includes(frame.event)) {
            controller.abort();
            return { status: response.status, frames };
          }
        }
        index = buffer.indexOf("\n\n");
      }
    }
    return { status: response.status, frames };
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    return { status: 200, frames };
  } finally {
    clearTimeout(timer);
  }
}

async function listen(app: TestApp): Promise<string> {
  await app.app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.app.server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return `http://127.0.0.1:${address.port}`;
}

async function start(app: TestApp, expertCount = 3): Promise<string> {
  const created = await app.app.inject({
    method: "POST",
    url: "/api/discussions",
    payload: {
      topic: "远程办公应该成为默认选项吗？",
      expertCount,
      clientRequestId: randomUUID(),
    },
  });
  const id = (created.json() as { discussion: { id: string } }).discussion.id;
  await app.app.inject({ method: "POST", url: `/api/discussions/${id}/confirm` });
  return id;
}

describe("SSE", () => {
  it("streams live, emits caught_up, and replays after Last-Event-ID", async () => {
    // Small per-chunk delay so the session is still `live` when the client
    // connects: this test must exercise the live path, not a full replay.
    current = await createTestApp({ config: { mock: { delayMs: 10 } } });
    const baseUrl = await listen(current);
    const id = await start(current, 3);

    const live = await connectSse(baseUrl, `/api/discussions/${id}/stream?after=0`, {
      stopOn: ["discussion.ended"],
      timeoutMs: 30_000,
    });
    expect(live.status).toBe(200);

    // Handshake: stream.ready first, with the replay contract fields.
    const ready = live.frames[0];
    expect(ready?.event).toBe("stream.ready");
    const readyData = JSON.parse(ready?.data ?? "{}") as {
      discussionId: string;
      status: string;
      lastSeq: number;
      fromSeq: number;
      retryMs: number;
    };
    expect(readyData.discussionId).toBe(id);
    expect(readyData.fromSeq).toBe(0);
    expect(readyData.retryMs).toBe(100);
    expect(readyData.status).toBe("live");
    expect(readyData.lastSeq).toBeGreaterThanOrEqual(1);

    // caught_up marks the end of the replay phase.
    const caughtUpIndex = live.frames.findIndex((f) => f.event === "stream.caught_up");
    expect(caughtUpIndex).toBeGreaterThan(0);
    expect(live.frames[caughtUpIndex]?.id).toBeNull();

    // Persisted frames: contiguous ids, terminal event last.
    const persisted = live.frames.filter((f) => f.id !== null);
    expect(persisted[0]?.id).toBe(1);
    persisted.forEach((frame, index) => {
      expect(frame.id).toBe(index + 1);
    });
    expect(persisted.at(-1)?.event).toBe("discussion.ended");

    // Ephemeral deltas must never carry an id and must precede their completed message.
    const deltas = live.frames.filter((f) => f.event === "message.delta");
    expect(deltas.length).toBeGreaterThan(0);
    for (const delta of deltas) expect(delta.id).toBeNull();

    // Reconnect from the middle: no duplicates, no gaps.
    const midpoint = Math.floor(persisted.length / 2);
    const midSeq = midpoint;
    const replay = await connectSse(baseUrl, `/api/discussions/${id}/stream?after=${midSeq}`, {
      headers: { "last-event-id": String(midSeq) },
      stopOn: ["discussion.ended"],
      timeoutMs: 15_000,
    });
    const replayPersisted = replay.frames.filter((f) => f.id !== null);
    expect(replayPersisted.length).toBeGreaterThan(0);
    expect(replayPersisted[0]?.id).toBe(midSeq + 1);
    replayPersisted.forEach((frame, index) => {
      expect(frame.id).toBe(midSeq + 1 + index);
    });
    expect(replayPersisted.at(-1)?.event).toBe("discussion.ended");

    // Already-ended session, client ahead of the log: ready + caught_up, then close.
    const ahead = await connectSse(baseUrl, `/api/discussions/${id}/stream?after=9999`, {
      timeoutMs: 5_000,
    });
    expect(ahead.frames[0]?.event).toBe("stream.ready");
    expect((JSON.parse(ahead.frames[0]?.data ?? "{}") as { status: string }).status).toBe(
      "ended",
    );
    expect(ahead.frames.some((f) => f.event === "discussion.ended")).toBe(false);
  }, 60_000);

  it("rejects with 429 when the per-session connection cap is hit, and 404 for unknown ids", async () => {
    current = await createTestApp({ config: { sse: { maxConnections: 1 } } });
    const baseUrl = await listen(current);

    const created = await current.app.inject({
      method: "POST",
      url: "/api/discussions",
      payload: {
        topic: "年轻人还应该把买房当作人生目标吗？",
        expertCount: 3,
        clientRequestId: randomUUID(),
      },
    });
    const id = (created.json() as { discussion: { id: string } }).discussion.id;

    const controller = new AbortController();
    const first = await fetch(`${baseUrl}/api/discussions/${id}/stream?after=0`, {
      headers: { accept: "text/event-stream" },
      signal: controller.signal,
    });
    expect(first.status).toBe(200);
    const reader = first.body?.getReader();
    await reader?.read();

    const second = await fetch(`${baseUrl}/api/discussions/${id}/stream?after=0`, {
      headers: { accept: "text/event-stream" },
    });
    expect(second.status).toBe(429);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SSE_LIMIT_REACHED");

    controller.abort();
    await reader?.cancel().catch(() => undefined);

    const unknown = await fetch(`${baseUrl}/api/discussions/${randomUUID()}/stream`, {
      headers: { accept: "text/event-stream" },
    });
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("content-type")).toContain("application/json");
  }, 30_000);
});
