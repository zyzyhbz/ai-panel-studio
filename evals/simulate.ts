import {
  buildDecisionPrompt,
  buildInsightPrompt,
  buildRosterPrompt,
  buildSpeechPrompt,
  buildSummaryPrompt,
  buildEligibility,
  buildFallbackSummary,
  buildMockMeta,
  MockLLMClient,
  normalizeInsights,
  normalizeRoster,
  parseDecisionOutput,
  parseInsightOutput,
  parseRosterOutput,
  parseSummaryText,
  sanitizeDecision,
  selectFallbackSpeaker,
  validateSpeech,
  type DiscussionSnapshot,
  type ExpertPersona,
  type InsightItem,
  type MockScenario,
  type TopicFixture,
  type TranscriptMessage,
} from "../packages/agent/src/index.ts";
import { maxTurnsFor, plannedTurnsFor } from "../packages/shared/src/index.ts";

/**
 * 用 MockLLMClient 跑一整场讨论（阵容 → 决策/发言 → 共识 → 总结）。
 *
 * 这是后端 SessionRunner 的"等价简化版"：调用顺序与 AGENT-API §8 一致，
 * 唯一区别是这里没有 DB/SSE，只把结果收在内存里，供 eval 统计。
 */

export interface SimulationOptions {
  fixture: TopicFixture;
  scenario?: MockScenario;
  /** 每次 mock 调用的模拟延迟（毫秒），用来测出可读的耗时分布 */
  latencyMs?: number;
  maxTurnsOverride?: number;
}

export interface StageTimings {
  decisionMs: number[];
  speechMs: number[];
  insightMs: number[];
  summaryMs: number;
}

export interface SimulationResult {
  fixture: TopicFixture;
  snapshot: DiscussionSnapshot;
  messages: TranscriptMessage[];
  insights: InsightItem[];
  summary: { content: string; paragraphs: string[]; isFallback: boolean; hasJsonLeak: boolean };
  calls: number;
  jsonCallCount: number;
  jsonOkCount: number;
  inputTokens: number;
  outputTokens: number;
  decisionRepairs: number;
  rejectedInsights: number;
  speechIssues: string[];
  timings: StageTimings;
}

const SIGNAL = new AbortController().signal;

export async function simulateSession(options: SimulationOptions): Promise<SimulationResult> {
  const { fixture } = options;
  const scenario = options.scenario ?? "normal";
  const client = new MockLLMClient({ fixture, scenario, latencyMs: options.latencyMs ?? 20 });
  const timings: StageTimings = { decisionMs: [], speechMs: [], insightMs: [], summaryMs: [] };

  /* 1) 阵容 */
  const rosterSpec = buildRosterPrompt({ topic: fixture.topic, expertCount: fixture.expertCount });
  const rosterRaw = await client.json({
    prompt: rosterSpec,
    signal: SIGNAL,
    timeoutMs: 20_000,
    parse: parseRosterOutput,
    meta: {
      discussionId: `eval-${fixture.id}`,
      scenario,
      turnIndex: 1,
      expertCount: fixture.expertCount,
      roster: [],
    },
  });
  const roster = normalizeRoster(rosterRaw.value, { expertCount: fixture.expertCount });
  const experts: ExpertPersona[] = [roster.host, ...roster.experts];

  let snapshot: DiscussionSnapshot = {
    discussionId: `eval-${fixture.id}`,
    topic: fixture.topic,
    expertCount: fixture.expertCount,
    status: "live",
    turnCount: 0,
    plannedTurns: plannedTurnsFor(fixture.expertCount),
    maxTurns: options.maxTurnsOverride ?? maxTurnsFor(fixture.expertCount),
    experts,
    messages: [],
    insights: [],
    summary: null,
  };

  let decisionRepairs = 0;
  let rejectedInsights = 0;
  const speechIssues: string[] = [];

  /* 2) 决策 + 发言循环 */
  while (snapshot.turnCount < snapshot.maxTurns) {
    const eligibility = buildEligibility(snapshot);
    const meta = buildMockMeta(snapshot, {
      scenario,
      allowedIds: eligibility.allowedSpeakers.map((s) => s.id),
      mustClose: eligibility.mustClose,
      turnIndex: eligibility.turnIndex,
    });

    const decisionStarted = Date.now();
    const decisionSpec = buildDecisionPrompt({ snapshot, eligibility });
    let decision;
    try {
      const result = await client.json({
        prompt: decisionSpec,
        signal: SIGNAL,
        timeoutMs: 8_000,
        parse: parseDecisionOutput,
        meta,
      });
      const sanitized = sanitizeDecision(result.value, snapshot, eligibility);
      decision = sanitized.decision;
      if (sanitized.repaired) decisionRepairs += 1;
    } catch {
      decision = selectFallbackSpeaker(snapshot, eligibility).decision;
      decisionRepairs += 1;
    }
    timings.decisionMs.push(Date.now() - decisionStarted);

    const speaker = snapshot.experts.find((e) => e.id === decision.speakerId);
    if (!speaker) break;

    const speechStarted = Date.now();
    const speechSpec = buildSpeechPrompt({ snapshot, decision, speaker });
    let text = "";
    try {
      for await (const delta of client.stream({
        prompt: speechSpec,
        signal: SIGNAL,
        firstTokenTimeoutMs: 6_000,
        totalTimeoutMs: 20_000,
        meta: { ...meta, speakerId: speaker.id, intent: decision.intent },
      })) {
        text += delta;
      }
    } catch {
      text = "";
    }

    const check = validateSpeech(text, {
      recent: snapshot.messages.slice(-3),
      isHost: speaker.role === "host",
    });
    if (!check.ok) speechIssues.push(...check.reasons);
    timings.speechMs.push(Date.now() - speechStarted);

    const message: TranscriptMessage = {
      id: `m_${snapshot.turnCount + 1}`,
      expertId: speaker.id,
      speakerName: speaker.name,
      turnIndex: snapshot.turnCount + 1,
      intent: decision.intent,
      content: check.text,
      charCount: check.charCount,
      degraded: !check.ok,
      ...(decision.targetMessageId ? { targetMessageId: decision.targetMessageId } : {}),
    };

    snapshot = {
      ...snapshot,
      messages: [...snapshot.messages, message],
      turnCount: snapshot.turnCount + 1,
    };

    if (decision.intent === "summary") break;

    /* 3) 每 2 轮刷新共识 */
    if (snapshot.turnCount % 2 === 0) {
      const insightStarted = Date.now();
      try {
        const insightSpec = buildInsightPrompt({ snapshot });
        const result = await client.json({
          prompt: insightSpec,
          signal: SIGNAL,
          timeoutMs: 15_000,
          parse: parseInsightOutput,
          meta,
        });
        const normalized = normalizeInsights(result.value.insights, snapshot, {
          turnIndex: snapshot.turnCount,
        });
        rejectedInsights += normalized.rejected.length;
        snapshot = { ...snapshot, insights: normalized.insights };
      } catch {
        // 保留旧快照
      }
      timings.insightMs.push(Date.now() - insightStarted);
    }
  }

  /* 4) 总结 */
  const summaryStarted = Date.now();
  let summary = { content: "", paragraphs: [] as string[], isFallback: false, hasJsonLeak: false };
  try {
    const summarySpec = buildSummaryPrompt({ snapshot });
    let text = "";
    for await (const delta of client.stream({
      prompt: summarySpec,
      signal: SIGNAL,
      firstTokenTimeoutMs: 6_000,
      totalTimeoutMs: 25_000,
      meta: buildMockMeta(snapshot, { scenario }),
    })) {
      text += delta;
    }
    const parsed = parseSummaryText(text);
    summary = {
      content: parsed.content,
      paragraphs: parsed.paragraphs,
      isFallback: false,
      hasJsonLeak: parsed.hasJsonLeak,
    };
  } catch {
    summary = {
      content: buildFallbackSummary(snapshot),
      paragraphs: buildFallbackSummary(snapshot).split(/\n\s*\n/u),
      isFallback: true,
      hasJsonLeak: false,
    };
  }
  timings.summaryMs.push(Date.now() - summaryStarted);

  const inputTokens = client.calls.reduce((sum, call) => sum + call.inputTokens, 0);
  const outputTokens = client.calls.reduce((sum, call) => sum + call.outputTokens, 0);
  const jsonCalls = client.calls.filter(
    (call) => call.promptKind !== "speech" && call.promptKind !== "summary",
  );

  return {
    fixture,
    snapshot,
    messages: snapshot.messages,
    insights: snapshot.insights,
    summary,
    calls: client.calls.length,
    jsonCallCount: jsonCalls.length,
    jsonOkCount: jsonCalls.filter((call) => call.ok).length,
    inputTokens,
    outputTokens,
    decisionRepairs,
    rejectedInsights,
    speechIssues,
    timings,
  };
}
