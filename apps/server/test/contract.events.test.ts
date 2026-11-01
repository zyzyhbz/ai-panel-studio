import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, sleep, type TestApp } from "./helpers/app";

/**
 * Contract conformance (docs/06-G1契约决议 §1.3 / §1.6 / §1.7).
 *
 * The frontend renders straight from these payloads, so a missing or renamed field
 * is a UI bug that only shows up much later. This test asserts the exact fields the
 * contract requires, per event type, from the persisted log.
 */

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

const EXPERT_FIELDS = [
  "id",
  "role",
  "name",
  "profession",
  "title",
  "stance",
  "stanceAxis",
  "polarity",
  "focusArea",
  "color",
  "sortOrder",
] as const;

const MESSAGE_FIELDS = [
  "id",
  "expertId",
  "speakerName",
  "speakerTitle",
  "speakerColor",
  "content",
  "intent",
  "turnIndex",
  "charCount",
  "degraded",
  "createdAt",
] as const;

const INSIGHT_FIELDS = [
  "id",
  "type",
  "content",
  "evidenceMessageIds",
  "firstSeenTurn",
  "updatedAt",
] as const;

function expectKeys(value: Record<string, unknown>, keys: readonly string[], where: string): void {
  for (const key of keys) {
    expect(Object.prototype.hasOwnProperty.call(value, key), `${where} missing "${key}"`).toBe(
      true,
    );
  }
}

describe("SSE payload contract", () => {
  it("emits every documented field for every persisted event", async () => {
    current = await createTestApp();
    const app = current;

    const created = await app.app.inject({
      method: "POST",
      url: "/api/discussions",
      payload: {
        topic: "AI 会不会让初级开发者失业？",
        expertCount: 3,
        clientRequestId: randomUUID(),
      },
    });
    const id = (created.json() as { discussion: { id: string } }).discussion.id;
    await app.app.inject({ method: "POST", url: `/api/discussions/${id}/confirm` });

    const startedAt = Date.now();
    while (Date.now() - startedAt < 30_000) {
      const res = await app.app.inject({ method: "GET", url: `/api/discussions/${id}` });
      if ((res.json() as { discussion: { status: string } }).discussion.status === "ended") break;
      await sleep(40);
    }

    const events = (
      await app.app.inject({
        method: "GET",
        url: `/api/discussions/${id}/events?after=0&limit=1000`,
      })
    ).json() as { items: EventRow[] };

    const byType = (type: string): EventRow[] => events.items.filter((e) => e.type === type);
    const seen = new Set(events.items.map((e) => e.type));

    // Every persisted type documented in §1.3 / the original SSE contract.
    for (const type of [
      "roster.ready",
      "discussion.started",
      "turn.started",
      "message.completed",
      "insight.updated",
      "discussion.summarizing",
      "summary.completed",
      "discussion.ended",
    ]) {
      expect(seen.has(type), `missing event type ${type}`).toBe(true);
    }

    // Every payload is tagged with its discussion (isolation relies on this).
    for (const event of events.items) {
      expect(event.payload.discussionId, `${event.type} discussionId`).toBe(id);
    }

    // roster.ready
    const roster = byType("roster.ready")[0]?.payload as { experts: Record<string, unknown>[] };
    expect(roster.experts).toHaveLength(4);
    for (const expert of roster.experts) expectKeys(expert, EXPERT_FIELDS, "roster.ready.expert");
    expect(roster.experts.filter((e) => e.role === "host")).toHaveLength(1);
    expect(new Set(roster.experts.map((e) => e.color)).size).toBe(4);

    // discussion.started
    expect(typeof byType("discussion.started")[0]?.payload.startedAt).toBe("string");

    // turn.started (messageId is required in v1.0 so deltas and completion share an id)
    for (const event of byType("turn.started")) {
      expectKeys(
        event.payload,
        [
          "discussionId",
          "turnIndex",
          "speakerId",
          "speakerName",
          "intent",
          "turnFocus",
          "messageId",
        ],
        "turn.started",
      );
      expect(typeof event.payload.turnIndex).toBe("number");
      expect(typeof event.payload.messageId).toBe("string");
    }

    // message.completed
    for (const event of byType("message.completed")) {
      const message = event.payload.message as Record<string, unknown>;
      expectKeys(message, MESSAGE_FIELDS, "message.completed.message");
      expect(typeof message.content).toBe("string");
      expect(typeof message.charCount).toBe("number");
      expect(typeof message.degraded).toBe("boolean");
      expect(message.charCount).toBe([...(message.content as string)].length);
      const turn = byType("turn.started").find(
        (e) => (e.payload as { messageId: string }).messageId === message.id,
      );
      expect(turn, "message.completed must follow its turn.started").toBeTruthy();
      expect((turn?.payload as { turnIndex: number }).turnIndex).toBe(message.turnIndex);
    }

    // insight.updated (full snapshot, stable ids, evidence required)
    const insightEvents = byType("insight.updated");
    expect(insightEvents.length).toBeGreaterThan(0);
    for (const event of insightEvents) {
      const insights = event.payload.insights as Record<string, unknown>[];
      expect(Array.isArray(insights)).toBe(true);
      for (const insight of insights) {
        expectKeys(insight, INSIGHT_FIELDS, "insight.updated.insight");
        expect(insight.evidenceMessageIds).toBeInstanceOf(Array);
        expect((insight.evidenceMessageIds as string[]).length).toBeGreaterThan(0);
        expect(typeof insight.firstSeenTurn).toBe("number");
        expect(insight.id).toMatch(/^i_[0-9a-f]{24}$/);
      }
    }

    // discussion.summarizing
    const summarizing = byType("discussion.summarizing")[0]?.payload as {
      reason: string;
      startedAt: string;
    };
    expect(["user", "auto"]).toContain(summarizing.reason);
    expect(typeof summarizing.startedAt).toBe("string");

    // summary.completed
    const summary = byType("summary.completed")[0]?.payload.summary as Record<string, unknown>;
    expectKeys(summary, ["content", "createdAt", "isFallback"], "summary.completed.summary");
    expect(typeof summary.content).toBe("string");
    expect(typeof summary.isFallback).toBe("boolean");
    // No JSON leakage into user-visible summary text.
    expect((summary.content as string).trim().startsWith("{")).toBe(false);
    expect(/"\w+"\s*:/.test(summary.content as string)).toBe(false);

    // discussion.ended is the last persisted event
    expect(events.items.at(-1)?.type).toBe("discussion.ended");
    expect(typeof (events.items.at(-1)?.payload as { endedAt: string }).endedAt).toBe("string");
  }, 60_000);

  it("emits stream.ready / stream.caught_up / message.delta with the documented shape", async () => {
    current = await createTestApp({ config: { mock: { delayMs: 8 } } });
    const app = current;

    await app.app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.app.server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const created = await app.app.inject({
      method: "POST",
      url: "/api/discussions",
      payload: {
        topic: "远程办公应该成为默认选项吗？",
        expertCount: 3,
        clientRequestId: randomUUID(),
      },
    });
    const id = (created.json() as { discussion: { id: string } }).discussion.id;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    timer.unref?.();
    const response = await fetch(`${baseUrl}/api/discussions/${id}/stream?after=0`, {
      headers: { accept: "text/event-stream" },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);

    // Confirm only after the stream is attached, so we see the live path.
    await app.app.inject({ method: "POST", url: `/api/discussions/${id}/confirm` });

    const frames: { event: string; data: Record<string, unknown>; id: number | null }[] = [];
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let index = buffer.indexOf("\n\n");
        while (index >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          index = buffer.indexOf("\n\n");
          const lines = block.split("\n");
          let event = "";
          let data = "";
          let frameId: number | null = null;
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
            else if (line.startsWith("id:")) frameId = Number.parseInt(line.slice(3).trim(), 10);
          }
          if (!event) continue;
          frames.push({ event, data: JSON.parse(data || "{}") as Record<string, unknown>, id: frameId });
          if (event === "discussion.ended") {
            controller.abort();
            index = -1;
            break;
          }
        }
        if (frames.some((f) => f.event === "discussion.ended")) break;
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      clearTimeout(timer);
    }

    const ready = frames.find((f) => f.event === "stream.ready");
    expect(ready).toBeTruthy();
    expectKeys(ready?.data ?? {}, ["discussionId", "status", "lastSeq", "fromSeq", "retryMs"], "stream.ready");
    expect(ready?.id).toBeNull();
    expect(ready?.data.fromSeq).toBe(0);

    const caughtUp = frames.find((f) => f.event === "stream.caught_up");
    expect(caughtUp).toBeTruthy();
    expectKeys(caughtUp?.data ?? {}, ["discussionId", "lastSeq"], "stream.caught_up");
    expect(caughtUp?.id).toBeNull();

    const delta = frames.find((f) => f.event === "message.delta");
    expect(delta, "expected at least one delta on the live path").toBeTruthy();
    expectKeys(
      delta?.data ?? {},
      ["discussionId", "messageId", "speakerId", "delta"],
      "message.delta",
    );
    expect(delta?.id).toBeNull();

    // The delta's messageId must equal the id later used by message.completed.
    const completed = frames.filter((f) => f.event === "message.completed");
    expect(completed.length).toBeGreaterThan(0);
    const completedIds = completed.map(
      (f) => (f.data.message as { id: string }).id,
    );
    expect(completedIds).toContain(delta?.data.messageId);

    // Persisted frames carry increasing ids; ephemeral ones never do.
    const persisted = frames.filter((f) => f.id !== null);
    persisted.forEach((frame, index) => expect(frame.id).toBe(index + 1));
  }, 60_000);
});
