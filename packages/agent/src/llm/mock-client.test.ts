import { describe, expect, it } from "vitest";
import { maxTurnsFor, plannedTurnsFor } from "@ai-panel/shared";
import { MockLLMClient, buildMockMeta } from "./mock-client";
import { TOPIC_FIXTURES, fixtureById, type TopicFixture } from "./fixtures";
import { buildRosterPrompt } from "../prompts/roster";
import { buildDecisionPrompt } from "../prompts/decision";
import { buildSpeechPrompt } from "../prompts/speech";
import { buildInsightPrompt } from "../prompts/insight";
import { buildSummaryPrompt } from "../prompts/summary";
import { parseDecisionOutput, parseInsightOutput, parseRosterOutput, parseSummaryText } from "../parse/output";
import { buildEligibility } from "../policy/eligibility";
import { sanitizeDecision } from "../policy/decision";
import { normalizeRoster } from "../policy/roster";
import { validateSpeech } from "../policy/speech";
import { normalizeInsights } from "../policy/insight";
import type { DiscussionSnapshot, InsightItem, TranscriptMessage } from "../core/types";
import type { MockScenario } from "./types";
import { makeSnapshot } from "../test-support/factories";

const SIGNAL = new AbortController().signal;

interface SessionResult {
  snapshot: DiscussionSnapshot;
  messages: TranscriptMessage[];
  insights: InsightItem[];
  summaryParagraphs: number;
  decisionRepairs: number;
  speechIssues: string[];
  rejectedInsights: number;
  clientCalls: number;
}

/**
 * 用 MockLLMClient 跑一整场：阵容 → 决策/发言循环 → 共识 → 总结。
 * 这就是后端 SessionRunner 的"等价简化版"，用来证明包能被真实驱动。
 */
async function runMockSession(
  fixture: TopicFixture,
  options: { scenario?: MockScenario; maxTurnsOverride?: number } = {},
): Promise<SessionResult> {
  const client = new MockLLMClient({ fixture, scenario: options.scenario ?? "normal" });
  const signal = SIGNAL;

  const rosterSpec = buildRosterPrompt({
    topic: fixture.topic,
    expertCount: fixture.expertCount,
  });
  const rosterResult = await client.json({
    prompt: rosterSpec,
    signal,
    timeoutMs: 5_000,
    parse: parseRosterOutput,
    meta: {
      discussionId: "d_mock",
      scenario: options.scenario ?? "normal",
      turnIndex: 1,
      expertCount: fixture.expertCount,
      roster: [],
    },
  });
  const roster = normalizeRoster(rosterResult.value, { expertCount: fixture.expertCount });

  let snapshot = makeSnapshot({
    discussionId: "d_mock",
    topic: fixture.topic,
    expertCount: fixture.expertCount,
    experts: [roster.host, ...roster.experts],
    plannedTurns: plannedTurnsFor(fixture.expertCount),
    maxTurns: options.maxTurnsOverride ?? maxTurnsFor(fixture.expertCount),
  });

  let decisionRepairs = 0;
  const speechIssues: string[] = [];
  let rejectedInsights = 0;

  while (snapshot.turnCount < snapshot.maxTurns) {
    const eligibility = buildEligibility(snapshot);
    const meta = buildMockMeta(snapshot, {
      allowedIds: eligibility.allowedSpeakers.map((s) => s.id),
      mustClose: eligibility.mustClose,
      turnIndex: eligibility.turnIndex,
      scenario: options.scenario ?? "normal",
    });

    const decisionSpec = buildDecisionPrompt({ snapshot, eligibility });
    let decision = sanitizeDecision(
      (
        await client.json({
          prompt: decisionSpec,
          signal,
          timeoutMs: 5_000,
          parse: parseDecisionOutput,
          meta,
        })
      ).value,
      snapshot,
      eligibility,
    );
    if (decision.repaired) decisionRepairs += 1;

    const speaker = snapshot.experts.find((e) => e.id === decision.decision.speakerId)!;
    const speechSpec = buildSpeechPrompt({ snapshot, decision: decision.decision, speaker });

    let text = "";
    for await (const delta of client.stream({
      prompt: speechSpec,
      signal,
      firstTokenTimeoutMs: 2_000,
      totalTimeoutMs: 10_000,
      meta: { ...meta, speakerId: speaker.id, intent: decision.decision.intent },
    })) {
      text += delta;
    }

    const check = validateSpeech(text, {
      recent: snapshot.messages.slice(-3),
      isHost: speaker.role === "host",
    });
    if (!check.ok) speechIssues.push(...check.reasons);

    const message: TranscriptMessage = {
      id: `m_${snapshot.turnCount + 1}`,
      expertId: speaker.id,
      speakerName: speaker.name,
      turnIndex: snapshot.turnCount + 1,
      intent: decision.decision.intent,
      content: check.text,
      charCount: check.charCount,
      degraded: !check.ok,
      ...(decision.decision.targetMessageId
        ? { targetMessageId: decision.decision.targetMessageId }
        : {}),
    };
    snapshot = {
      ...snapshot,
      messages: [...snapshot.messages, message],
      turnCount: snapshot.turnCount + 1,
    };

    if (decision.decision.intent === "summary") break;

    if (snapshot.turnCount % 2 === 0) {
      const insightSpec = buildInsightPrompt({ snapshot });
      try {
        const insightResult = await client.json({
          prompt: insightSpec,
          signal,
          timeoutMs: 8_000,
          parse: parseInsightOutput,
          meta,
        });
        const normalized = normalizeInsights(insightResult.value.insights, snapshot, {
          turnIndex: snapshot.turnCount,
        });
        rejectedInsights += normalized.rejected.length;
        snapshot = { ...snapshot, insights: normalized.insights };
      } catch {
        // 保留旧快照
      }
    }
  }

  const summarySpec = buildSummaryPrompt({ snapshot });
  let summaryText = "";
  for await (const delta of client.stream({
    prompt: summarySpec,
    signal,
    firstTokenTimeoutMs: 2_000,
    totalTimeoutMs: 10_000,
    meta: buildMockMeta(snapshot),
  })) {
    summaryText += delta;
  }
  const summary = parseSummaryText(summaryText);

  return {
    snapshot,
    messages: snapshot.messages,
    insights: snapshot.insights,
    summaryParagraphs: summary.paragraphs.length,
    decisionRepairs,
    speechIssues,
    rejectedInsights,
    clientCalls: client.calls.length,
  };
}

function maxConsecutive(messages: TranscriptMessage[]): number {
  let max = 0;
  let current = 0;
  let last = "";
  for (const message of messages) {
    current = message.expertId === last ? current + 1 : 1;
    last = message.expertId;
    if (current > max) max = current;
  }
  return max;
}

describe("MockLLMClient 全链路（E1，4 人）", () => {
  it("能跑完 8–12 轮，人人发言，不出现 3 连，产出共识与三段总结", async () => {
    const fixture = fixtureById("E1")!;
    const result = await runMockSession(fixture);

    expect(result.messages.length).toBeGreaterThanOrEqual(8);
    expect(result.messages.length).toBeLessThanOrEqual(12);
    expect(result.messages[0]?.intent).toBe("opening");

    const spoken = new Set(result.messages.map((m) => m.expertId));
    for (const expert of result.snapshot.experts.filter((e) => e.role === "expert")) {
      expect(spoken.has(expert.id)).toBe(true);
    }

    expect(maxConsecutive(result.messages)).toBeLessThanOrEqual(2);
    expect(result.messages.some((m) => m.intent === "summary")).toBe(true);

    expect(result.insights.some((i) => i.type === "consensus")).toBe(true);
    expect(result.insights.some((i) => i.type === "divergence")).toBe(true);
    for (const insight of result.insights) {
      expect(insight.evidenceMessageIds.length).toBeGreaterThan(0);
      for (const id of insight.evidenceMessageIds) {
        expect(result.messages.map((m) => m.id)).toContain(id);
      }
    }

    expect(result.summaryParagraphs).toBe(3);
    expect(result.rejectedInsights).toBe(0);
    expect(result.clientCalls).toBeGreaterThan(10);
  });

  it("发言长度全部 ≤120 字（主持人 ≤60 字）", async () => {
    const result = await runMockSession(fixtureById("E1")!);
    for (const message of result.messages) {
      const isHost = message.expertId === "e_host";
      expect(message.charCount).toBeLessThanOrEqual(isHost ? 61 : 120);
      expect(message.content).not.toMatch(/[{}]/u);
    }
  });

  it("E5（6 人）也能覆盖所有专家", async () => {
    const result = await runMockSession(fixtureById("E5")!);
    const spoken = new Set(result.messages.map((m) => m.expertId));
    expect(spoken.size).toBeGreaterThanOrEqual(6);
  });
});

describe("MockLLMClient 故障注入", () => {
  it("timeout：抛 LlmError(timeout)", async () => {
    const client = new MockLLMClient({ fixture: TOPIC_FIXTURES[0]!, scenario: "timeout" });
    const spec = buildRosterPrompt({ topic: "t", expertCount: 4 });
    await expect(
      client.json({ prompt: spec, signal: SIGNAL, timeoutMs: 1000, parse: parseRosterOutput }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("invalid-json：第一次坏、第二次好，标记 repaired", async () => {
    const client = new MockLLMClient({ fixture: TOPIC_FIXTURES[0]!, scenario: "invalid-json" });
    const spec = buildRosterPrompt({ topic: "t", expertCount: 4 });
    const result = await client.json({
      prompt: spec,
      signal: SIGNAL,
      timeoutMs: 1000,
      parse: parseRosterOutput,
    });
    expect(result.repaired).toBe(true);
    expect(result.value.experts).toHaveLength(4);
  });

  it("empty：抛 LlmError(empty_output)", async () => {
    const client = new MockLLMClient({ fixture: TOPIC_FIXTURES[0]!, scenario: "empty" });
    const spec = buildRosterPrompt({ topic: "t", expertCount: 4 });
    await expect(
      client.json({ prompt: spec, signal: SIGNAL, timeoutMs: 1000, parse: parseRosterOutput }),
    ).rejects.toMatchObject({ kind: "empty_output" });
  });

  it("runaway：模型给了不存在的人，sanitize 必须救回来", async () => {
    const client = new MockLLMClient({ fixture: TOPIC_FIXTURES[0]!, scenario: "runaway" });
    const snapshot = makeSnapshot({
      messages: [
        {
          id: "m_1",
          expertId: "e_host",
          speakerName: "林致远",
          turnIndex: 1,
          intent: "opening",
          content: "开场。",
          charCount: 3,
          degraded: false,
        },
      ],
      turnCount: 1,
    });
    const eligibility = buildEligibility(snapshot);
    const spec = buildDecisionPrompt({ snapshot, eligibility });
    const result = await client.json({
      prompt: spec,
      signal: SIGNAL,
      timeoutMs: 1000,
      parse: parseDecisionOutput,
      meta: buildMockMeta(snapshot, {
        allowedIds: eligibility.allowedSpeakers.map((s) => s.id),
        turnIndex: eligibility.turnIndex,
      }),
    });
    expect(result.value.speakerId).toBe("e_ghost");

    const sanitized = sanitizeDecision(result.value, snapshot, eligibility);
    expect(sanitized.repaired).toBe(true);
    expect(eligibility.allowedSpeakers.map((s) => s.id)).toContain(
      sanitized.decision.speakerId,
    );
  });

  it("duplicate：复读上一句会被判定为 repetitive", async () => {
    const client = new MockLLMClient({ fixture: TOPIC_FIXTURES[0]!, scenario: "duplicate" });
    const previous = "AI 先替代的是任务，不是人。";
    const spec = buildSpeechPrompt({
      snapshot: makeSnapshot(),
      decision: { speakerId: "e_1", intent: "rebut", turnFocus: "岗位结构" },
      speaker: makeSnapshot().experts[1]!,
    });
    let text = "";
    for await (const delta of client.stream({
      prompt: spec,
      signal: SIGNAL,
      firstTokenTimeoutMs: 1000,
      totalTimeoutMs: 5000,
      meta: {
        discussionId: "d",
        scenario: "duplicate",
        turnIndex: 2,
        expertCount: 4,
        roster: [],
        previousContent: previous,
        speakerId: "e_1",
        intent: "rebut",
      },
    })) {
      text += delta;
    }
    const check = validateSpeech(text, {
      recent: [
        {
          id: "m_1",
          expertId: "e_2",
          speakerName: "许澜",
          turnIndex: 1,
          intent: "extend",
          content: previous,
          charCount: previous.length,
        },
      ],
    });
    expect(check.repeated).toBe(true);
    expect(check.ok).toBe(false);
  });

  it("long：超长发言被截断到 120 字内", async () => {
    const client = new MockLLMClient({ fixture: TOPIC_FIXTURES[0]!, scenario: "long" });
    const snapshot = makeSnapshot();
    const spec = buildSpeechPrompt({
      snapshot,
      decision: { speakerId: "e_1", intent: "extend", turnFocus: "岗位结构" },
      speaker: snapshot.experts[1]!,
    });
    let text = "";
    for await (const delta of client.stream({
      prompt: spec,
      signal: SIGNAL,
      firstTokenTimeoutMs: 1000,
      totalTimeoutMs: 5000,
      meta: {
        discussionId: "d",
        scenario: "long",
        turnIndex: 2,
        expertCount: 4,
        roster: [],
        speakerId: "e_1",
        intent: "extend",
      },
    })) {
      text += delta;
    }
    const check = validateSpeech(text);
    expect(Array.from(text).length).toBeGreaterThan(120);
    expect(check.charCount).toBeLessThanOrEqual(120);
  });
});
