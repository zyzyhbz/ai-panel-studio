import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createMockLlmClient } from "../src/llm/mock";
import { buildChatBody, resolveThinking } from "../src/llm/deepseek";
import type { LLMClient, LlmJsonRequest, LlmStreamRequest, PromptSpec } from "../src/llm/types";
import {
  isClosingSignal,
  isTerminalTurn,
} from "../src/session/session-runner";
import { coverageFloorFor, turnCeilingFor } from "../src/services/turn-policy";
import { createTestApp, sleep, type TestApp } from "./helpers/app";

/**
 * Turn policy (docs/09 §5 + PM correction):
 * closing is driven by argument saturation, not by a turn target.
 * - coverageFloor = min(12, 2n+2)  → "cannot close earlier than"
 * - maxTurns = 36                  → safety ceiling
 * - the API exposes `plannedTurns` = coverageFloor (field kept for compatibility)
 */

let current: TestApp | null = null;

afterEach(async () => {
  if (current) {
    await current.dispose();
    current = null;
  }
});

/** Wrap the deterministic mock so we can steer close signals / targets per turn. */
function steerableClient(options: {
  /** Answer with `support` only: no new challenges, so saturation can be reached. */
  supportOnly?: boolean;
  /** Keep answering the opening message: challenges pile up, saturation never comes. */
  fixedTarget?: boolean;
}): LLMClient {
  const base = createMockLlmClient({});
  return {
    mode: "mock",
    model: "fake-mock",
    async json<T>(request: LlmJsonRequest<T>) {
      const result = await base.json(request);
      if (request.prompt.kind !== "decision") return result;
      const ids = request.meta?.messageIds ?? [];
      const value = { ...(result.value as Record<string, unknown>) };
      if (options.supportOnly && ids.length > 0) {
        const speakerId = String(value.speakerId ?? "");
        const role = request.meta?.candidates?.find((c) => c.id === speakerId)?.role;
        // The host must press at least once (saturation checks `hostPressed`),
        // everyone else only supports, so no challenge is ever left open. The target
        // stays as proposed and `sanitizeDecision` repairs a self-target.
        value.intent = role === "host" ? "probe" : "support";
      }
      if (options.fixedTarget) {
        const first = ids[0];
        if (first) value.targetMessageId = first;
      }
      return { ...result, value: value as T };
    },
    stream(request: LlmStreamRequest) {
      return base.stream(request);
    },
  };
}

async function createAndConfirm(
  app: TestApp,
  expertCount: number,
): Promise<{ id: string; plannedTurns: number; maxTurns: number }> {
  const created = await app.app.inject({
    method: "POST",
    url: "/api/discussions",
    payload: {
      topic: "AI 会不会让初级开发者失业？",
      expertCount,
      clientRequestId: randomUUID(),
    },
  });
  const body = created.json() as {
    discussion: { id: string; plannedTurns: number; maxTurns: number };
  };
  await app.app.inject({ method: "POST", url: `/api/discussions/${body.discussion.id}/confirm` });
  return {
    id: body.discussion.id,
    plannedTurns: body.discussion.plannedTurns,
    maxTurns: body.discussion.maxTurns,
  };
}

async function waitEnded(
  app: TestApp,
  id: string,
  timeoutMs = 60_000,
): Promise<{
  status: string;
  turnCount: number;
  messages: { intent: string }[];
  summary: { content: string } | null;
}> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const res = await app.app.inject({ method: "GET", url: `/api/discussions/${id}` });
    const body = res.json() as {
      discussion: { status: string; turnCount: number };
      messages: { intent: string }[];
      summary: { content: string } | null;
    };
    if (body.discussion.status === "ended") {
      return {
        status: body.discussion.status,
        turnCount: body.discussion.turnCount,
        messages: body.messages,
        summary: body.summary,
      };
    }
    if (body.discussion.status === "failed") throw new Error("discussion failed");
    await sleep(30);
  }
  throw new Error("did not end in time");
}

describe("coverage floor vs turn ceiling", () => {
  it("computes the floor from expert count and a flat 36 ceiling", () => {
    expect(coverageFloorFor(3)).toBe(8);
    expect(coverageFloorFor(4)).toBe(10);
    expect(coverageFloorFor(5)).toBe(12);
    expect(coverageFloorFor(6)).toBe(12);
    // Out-of-range inputs clamp to the supported 3..6 band.
    expect(coverageFloorFor(1)).toBe(8);
    expect(coverageFloorFor(9)).toBe(12);
    expect(turnCeilingFor(3)).toBe(36);
    expect(turnCeilingFor(6)).toBe(36);
  });

  it("exposes plannedTurns as the floor and maxTurns as 36", async () => {
    current = await createTestApp();
    for (const [expertCount, floor] of [
      [3, 8],
      [4, 10],
      [5, 12],
      [6, 12],
    ] as const) {
      const created = await current.app.inject({
        method: "POST",
        url: "/api/discussions",
        payload: {
          topic: `floor probe ${expertCount}`,
          expertCount,
          clientRequestId: randomUUID(),
        },
      });
      const discussion = (created.json() as {
        discussion: { plannedTurns: number; maxTurns: number; expertCount: number };
      }).discussion;
      expect(discussion.plannedTurns).toBe(floor);
      expect(discussion.maxTurns).toBe(36);
      expect(discussion.expertCount).toBe(expertCount);
    }
  }, 30_000);
});

describe("closing is driven by saturation, not by the floor", () => {
  it("runs past the coverage floor and ends by saturation or the 36 ceiling", async () => {
    // Always answering the *opening* message leaves challenges unanswered for as
    // long as the model keeps raising them, but saturation may still arrive early —
    // that is correct behaviour. What matters: it never stops at the floor, never
    // exceeds 36, and the last turn is the host's summary.
    current = await createTestApp({ llm: steerableClient({ fixedTarget: true }) });
    const { id, plannedTurns } = await createAndConfirm(current, 3);
    expect(plannedTurns).toBe(8);

    const ended = await waitEnded(current, id);
    expect(ended.status).toBe("ended");
    expect(ended.turnCount).toBeGreaterThan(plannedTurns);
    expect(ended.turnCount).toBeLessThanOrEqual(36);
    // The closing turn must be a host summary, and the closing summary exists.
    expect(ended.messages.at(-1)?.intent).toBe("summary");
    expect(ended.summary?.content.length ?? 0).toBeGreaterThan(20);

    const events = (
      await current.app.inject({
        method: "GET",
        url: `/api/discussions/${id}/events?after=0&limit=1000`,
      })
    ).json() as { items: { type: string }[] };
    expect(events.items.at(-1)?.type).toBe("discussion.ended");
  }, 120_000);

  it("ends early once the debate saturates, before the 36 ceiling", async () => {
    // Support-only turns never raise new challenges, so the only thing keeping the
    // debate open disappears: the policy saturates shortly after the coverage floor
    // and the host closes well before 36.
    current = await createTestApp({ llm: steerableClient({ supportOnly: true }) });
    const { id, plannedTurns } = await createAndConfirm(current, 3);

    const ended = await waitEnded(current, id);
    expect(ended.status).toBe("ended");
    expect(ended.turnCount).toBeGreaterThanOrEqual(plannedTurns);
    expect(ended.turnCount).toBeLessThan(36);
    expect(ended.messages.at(-1)?.intent).toBe("summary");
    expect(ended.summary?.content.length ?? 0).toBeGreaterThan(20);

    // No turn may start after the closing turn.
    const events = (
      await current.app.inject({
        method: "GET",
        url: `/api/discussions/${id}/events?after=0&limit=1000`,
      })
    ).json() as { items: { type: string; payload: Record<string, unknown> }[] };
    const turnIndexes = events.items
      .filter((e) => e.type === "turn.started")
      .map((e) => e.payload.turnIndex as number);
    expect(turnIndexes).toHaveLength(ended.turnCount);
    expect(turnIndexes.at(-1)).toBe(ended.turnCount);
    expect(events.items.at(-1)?.type).toBe("discussion.ended");
  }, 120_000);
});

describe("closing decision predicates", () => {
  it("treats summary as a close signal but only action=close as terminal", () => {
    expect(isClosingSignal({ speakerId: "h", intent: "summary", turnFocus: "收尾" })).toBe(true);
    expect(isClosingSignal({ speakerId: "h", intent: "rebut", turnFocus: "反驳" })).toBe(false);
    expect(
      isClosingSignal({ speakerId: "h", intent: "rebut", turnFocus: "反驳", action: "close" }),
    ).toBe(true);

    // An expert sanitized into `summary` must NOT end the session on its own.
    expect(isTerminalTurn({ speakerId: "e1", intent: "summary", turnFocus: "收尾" })).toBe(false);
    expect(
      isTerminalTurn({ speakerId: "h", intent: "summary", turnFocus: "收尾", action: "close" }),
    ).toBe(true);
  });
});

describe("thinking configuration", () => {
  const spec: PromptSpec = {
    kind: "speech",
    system: "sys",
    user: "usr",
    responseFormat: "text",
    temperature: 0.8,
    maxOutputTokens: 321,
  };
  const messages = [{ role: "user", content: "hi" }];

  it("omits the thinking field when thinking is enabled (provider default = on)", () => {
    const body = buildChatBody({ model: "m", thinking: "enabled", spec, json: false, messages });
    expect("thinking" in body).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.response_format).toBeUndefined();
    expect(body.max_tokens).toBe(321);
  });

  it("sends the explicit off field when thinking is disabled", () => {
    const body = buildChatBody({ model: "m", thinking: "disabled", spec, json: true, messages });
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.stream).toBe(false);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("lets a prompt disable thinking even when the global config is enabled", () => {
    // SPEECH/SUMMARY run with thinking on, DECIDE/INSIGHT/ROSTER off. A prompt that
    // says `disabled` must win over a global `enabled`, and the request body must
    // carry the explicit off field.
    const resolved = resolveThinking("enabled", "disabled");
    expect(resolved).toBe("disabled");
    const body = buildChatBody({ model: "m", thinking: resolved, spec, json: true, messages });
    expect(body.thinking).toEqual({ type: "disabled" });

    // A global `disabled` wins over a prompt asking for thinking.
    expect(resolveThinking("disabled", "enabled")).toBe("disabled");
    // No per-prompt preference -> provider default (on = omit the field).
    expect(resolveThinking("enabled", undefined)).toBe("enabled");
    expect(resolveThinking("enabled", "enabled")).toBe("enabled");
  });

  it("keeps reasoning_content out of the streamed text", async () => {
    const client = createMockLlmClient({});
    const collected: string[] = [];
    const stream = client.stream({
      prompt: spec,
      signal: AbortSignal.timeout(5_000),
      firstTokenTimeoutMs: 1_000,
      totalTimeoutMs: 5_000,
      meta: {
        discussionId: "d_debug",
        scenario: "normal",
        turnIndex: 1,
        expertCount: 3,
        roster: [],
        intent: "rebut",
        turnFocus: "岗位结构",
        topic: "AI 与初级岗位",
      },
    });
    for await (const chunk of stream) collected.push(chunk);
    const text = collected.join("");
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/reasoning|思考过程|我的推理/);
  });
});
