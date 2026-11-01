import type { DiscussionSnapshot } from "../core/types";
import { estimateTokens, hash32 } from "../core/text";
import {
  LlmError,
  type LLMClient,
  type LlmJsonRequest,
  type LlmJsonResult,
  type LlmMockMeta,
  type LlmStreamRequest,
  type LlmStreamResult,
  type MockScenario,
  type PromptKind,
} from "./types";
import {
  TOPIC_FIXTURES,
  fixtureById,
  fixtureRosterJson,
  type TopicFixture,
} from "./fixtures";

/**
 * Mock LLM client：给单测与 `evals/` 用，零网络、零成本、可复现。
 *
 * 与 server 侧运行时 mock 的区别：
 * - 这个 mock 面向"行为评测"，数据来自 5 个议题 fixture，能跑完整场讨论；
 * - 它实现同一套 `LLMClient`，因此也能被 server 直接注入（可选）。
 *
 * 故障注入（`scenario`）覆盖 AGENT-BEHAVIOR §9.1 的失败矩阵。
 */

export interface MockCallRecord {
  promptKind: PromptKind;
  promptId?: string;
  scenario: MockScenario;
  attempt: number;
  ok: boolean;
  latencyMs: number;
  includedMessageIds: string[];
  inputTokens: number;
  outputTokens: number;
}

export interface MockClientOptions {
  fixture?: TopicFixture;
  fixtureId?: string;
  scenario?: MockScenario;
  /** 每次调用的模拟延迟（毫秒），默认 0 */
  latencyMs?: number;
  /** 流式分片大小（字符），默认 12 */
  chunkSize?: number;
}

const FALLBACK_FOCUS = "讨论的推进方向";
const INTENT_CYCLE = ["rebut", "extend", "support", "clarify"] as const;

export class MockLLMClient implements LLMClient {
  readonly mode = "mock" as const;
  readonly model = "mock-deepseek-flash";

  readonly calls: MockCallRecord[] = [];

  private readonly fixture: TopicFixture;
  private readonly scenario: MockScenario;
  private readonly latencyMs: number;
  private readonly chunkSize: number;
  private lastSpeech = "";
  private hostProbeDone = false;
  private hostMediateDone = false;
  private readonly speechCursor = new Map<string, number>();

  constructor(options: MockClientOptions = {}) {
    const byId = options.fixtureId ? fixtureById(options.fixtureId) : undefined;
    this.fixture = options.fixture ?? byId ?? TOPIC_FIXTURES[0]!;
    this.scenario = options.scenario ?? "normal";
    this.latencyMs = options.latencyMs ?? 0;
    this.chunkSize = options.chunkSize ?? 12;
  }

  /* -------------------------------------------------------------- json */

  async json<T>(request: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
    const kind = request.prompt.kind;
    const started = Date.now();

    if (this.scenario === "timeout") {
      this.record(kind, request, 1, false, started, 0, 0);
      throw new LlmError("timeout", `mock: ${kind} 超时`);
    }
    await sleep(this.latencyMs, request.signal);

    const first = this.renderJson(kind, request.meta, 1);
    try {
      const value = request.parse(first);
      const usage = this.usage(request, first);
      this.record(kind, request, 1, true, started, usage.inputTokens, usage.outputTokens);
      return { value, raw: first, usage, repaired: false };
    } catch (firstError) {
      if (this.scenario === "empty") {
        this.record(kind, request, 1, false, started, 0, 0);
        throw new LlmError("empty_output", `mock: ${kind} 返回空内容`);
      }
      const second = this.renderJson(kind, request.meta, 2);
      try {
        const value = request.parse(second);
        const usage = this.usage(request, second);
        this.record(kind, request, 2, true, started, usage.inputTokens, usage.outputTokens);
        return { value, raw: second, usage, repaired: true };
      } catch (secondError) {
        this.record(kind, request, 2, false, started, 0, 0);
        const message =
          firstError instanceof Error ? firstError.message : String(firstError);
        throw new LlmError(
          "invalid_output",
          `mock: ${kind} 两次解析都失败（${message}; ${describe(secondError)}）`,
        );
      }
    }
  }

  /* ------------------------------------------------------------ stream */

  async *stream(request: LlmStreamRequest): AsyncGenerator<string, LlmStreamResult, void> {
    const kind = request.prompt.kind;
    const started = Date.now();

    if (this.scenario === "timeout") {
      this.record(kind, request, 1, false, started, 0, 0);
      throw new LlmError("timeout", `mock: ${kind} 超时`);
    }
    await sleep(this.latencyMs, request.signal);

    const text = this.renderText(kind, request.meta, request.prompt);
    const chunks = chunkText(text, this.chunkSize);

    // 首片之前再检查一次 abort，模拟"首 token 前被取消"
    for (const chunk of chunks) {
      if (request.signal.aborted) {
        this.record(kind, request, 1, false, started, 0, 0);
        throw new LlmError("aborted", "mock: aborted");
      }
      await sleep(0, request.signal);
      yield chunk;
    }

    this.lastSpeech = text;
    const usage = {
      inputTokens: estimateTokens(request.prompt.system) + estimateTokens(request.prompt.user),
      outputTokens: estimateTokens(text),
    };
    this.record(kind, request, 1, true, started, usage.inputTokens, usage.outputTokens);
    return { usage };
  }

  /* ------------------------------------------------------------ render */

  private renderJson(kind: PromptKind, meta: LlmMockMeta | undefined, attempt: number): string {
    if (this.scenario === "empty") return "";
    if (this.scenario === "invalid-json" && attempt === 1) {
      return kind === "decision"
        ? '{"speakerId": "e_1", "intent": '
        : '{"insights": [{"type": "consensus", ';
    }
    switch (kind) {
      case "roster":
        return fixtureRosterJson(this.fixture);
      case "decision":
        return this.decisionJson(meta);
      case "insight":
        return this.insightJson(meta);
      default:
        // summary 是纯文本，走 renderText；这里给个安全值
        return "{}";
    }
  }

  private renderText(
    kind: PromptKind,
    meta: LlmMockMeta | undefined,
    prompt: { system: string; user: string },
  ): string {
    if (kind === "summary") return this.summaryText();

    const speakerName = meta?.speakerId
      ? (meta.roster.find((r) => r.id === meta.speakerId)?.name ?? "")
      : "";

    if (this.scenario === "duplicate") {
      return meta?.previousContent ?? this.fixture.experts[0]?.lines[0]?.text ?? "我再补充一点。";
    }
    if (this.scenario === "long") {
      const base = this.pickLine(meta, speakerName);
      return `${base}而且这件事还有一层：投入的节奏、组织的承接能力、以及谁来为试错买单，都会改变结论；只看单点收益会高估短期、低估长期，真正的成本往往落在没有话语权的那一端，这一点在任何一轮讨论里都不该被跳过。`;
    }
    if (this.scenario === "mixed" && (meta?.turnIndex ?? 0) % 3 === 0) {
      return "";
    }
    void prompt;
    return this.pickLine(meta, speakerName);
  }

  private pickLine(meta: LlmMockMeta | undefined, speakerName: string): string {
    const speakerId = meta?.speakerId;
    const role = meta?.roster?.find((r) => r.id === speakerId)?.role;
    if (role === "host") return this.hostLine(meta);

    const expert =
      this.fixture.experts.find((e) => e.name === speakerName) ?? this.fixture.experts[0];
    if (!expert) return "我再补充一点。";

    const intent = meta?.intent;
    const matched = intent ? expert.lines.filter((line) => line.intent === intent) : [];
    // 该意图只有一句时用全部台词，避免同一人隔轮复读同一句
    const pool = matched.length > 1 ? matched : expert.lines;
    if (pool.length === 0) return "我再补充一点。";

    // 同一人同一意图连续发言时轮换台词，避免整场复读
    const cursorKey = `${expert.name}|${intent ?? "-"}`;
    const index = this.speechCursor.get(cursorKey) ?? 0;
    this.speechCursor.set(cursorKey, index + 1);
    return pool[index % pool.length]!.text;
  }

  /** 主持人没有 fixture 台词，按分型现场拼（≤60 字）。 */
  private hostLine(meta: LlmMockMeta | undefined): string {
    const intent = meta?.intent ?? "probe";
    const topic = meta?.topic ?? this.fixture.topic;
    const snippet = Array.from(meta?.previousContent ?? "").slice(0, 14).join("");

    switch (intent) {
      case "opening":
        return `今天不急着站队。先问一句：${Array.from(topic).slice(0, 22).join("")}，各位的第一判断是什么？`;
      case "mediate":
        return "你们一个在算代价、一个在算机会，其实争的是同一件事的两面，先说说各自的前提。";
      case "summary":
        return "这场不急着给答案，先把分歧的位置标清楚。";
      case "probe":
      default:
        return snippet
          ? `你刚才说「${snippet}」，能不能给一个具体例子？`
          : "能不能给一个具体例子，而不是只给判断？";
    }
  }

  private decisionJson(meta: LlmMockMeta | undefined): string {
    const roster =
      meta?.roster && meta.roster.length > 0
        ? meta.roster
        : [
            { id: "e_host", role: "host" as const, name: this.fixture.host.name },
            ...this.fixture.experts.map((e, i) => ({
              id: `e_${i + 1}`,
              role: "expert" as const,
              name: e.name,
            })),
          ];
    const allowedIds = meta?.allowedIds;
    const pool = allowedIds ? roster.filter((r) => allowedIds.includes(r.id)) : roster;
    const host = pool.find((r) => r.role === "host");
    const experts = pool.filter((r) => r.role === "expert");
    const turn = meta?.turnIndex ?? 1;

    if (this.scenario === "runaway") {
      return JSON.stringify({
        speakerId: "e_ghost",
        intent: "rebut",
        turnFocus: FALLBACK_FOCUS,
        action: "next",
      });
    }

    if (meta?.mustClose && host) {
      return JSON.stringify({
        speakerId: host.id,
        intent: "summary",
        turnFocus: "讨论的收束点",
        action: "close",
        reasonCode: "closing",
      });
    }

    if (turn <= 1 && host) {
      return JSON.stringify({
        speakerId: host.id,
        intent: "opening",
        turnFocus: "讨论的切口",
        action: "next",
        reasonCode: "fresh_voice",
      });
    }

    // 主持人义务：一次追问 + 一次串联（AR-02），只在守卫允许时执行
    if (host && !this.hostProbeDone && turn >= 3) {
      this.hostProbeDone = true;
      return JSON.stringify({
        speakerId: host.id,
        intent: "probe",
        targetMessageId: meta?.messageIds?.at(-1),
        turnFocus: "把说法落到具体例子上",
        action: "next",
        reasonCode: "follow_up",
      });
    }
    if (host && this.hostProbeDone && !this.hostMediateDone && turn >= 6) {
      this.hostMediateDone = true;
      return JSON.stringify({
        speakerId: host.id,
        intent: "mediate",
        references: pickTwoSpeakerIds(meta),
        turnFocus: "两种说法在争什么",
        action: "next",
        reasonCode: "follow_up",
      });
    }

    // 只剩主持人时（收尾前的追问窗口）
    if (experts.length === 0 && host) {
      return JSON.stringify({
        speakerId: host.id,
        intent: "probe",
        turnFocus: "把分歧问具体",
        action: "next",
        reasonCode: "follow_up",
      });
    }

    // 先按"谁说得少"再按稳定哈希挑人：既均衡、又不是名单序或固定周期
    const speakCounts = new Map<string, number>();
    for (const id of meta?.messageSpeakerIds ?? []) {
      speakCounts.set(id, (speakCounts.get(id) ?? 0) + 1);
    }
    const lastSpeakerId = meta?.messageSpeakerIds?.at(-1);
    const seed = `${meta?.discussionId ?? "d"}|${turn}`;
    const ordered = [...experts].sort((a, b) => {
      const ca = speakCounts.get(a.id) ?? 0;
      const cb = speakCounts.get(b.id) ?? 0;
      if (ca !== cb) return ca - cb;
      return hash32(`${seed}|${a.id}`).localeCompare(hash32(`${seed}|${b.id}`));
    });
    const speaker =
      ordered.find((candidate) => candidate.id !== lastSpeakerId) ?? ordered[0] ?? host;
    const intent = INTENT_CYCLE[turn % INTENT_CYCLE.length];
    const targetId = meta?.messageIds?.at(-1);

    const payload: Record<string, unknown> = {
      speakerId: speaker?.id ?? "e_1",
      intent,
      turnFocus: this.focusFor(speaker?.name),
      action: "next",
      reasonCode: intent === "rebut" ? "direct_clash" : "fills_gap",
    };
    if (targetId && (intent === "rebut" || intent === "support")) {
      payload.targetMessageId = targetId;
    }
    return JSON.stringify(payload);
  }

  private insightJson(meta: LlmMockMeta | undefined): string {
    const ids = meta?.messageIds ?? [];
    if (ids.length < 2) return JSON.stringify({ insights: [] });

    const speakers = meta?.messageSpeakerIds ?? [];
    const hostIds = new Set(
      (meta?.roster ?? []).filter((r) => r.role === "host").map((r) => r.id),
    );
    const pair = pickEvidencePair(ids, speakers, hostIds);
    return JSON.stringify({
      insights: [
        { type: "consensus", content: this.fixture.insights.consensus, evidenceMessageIds: pair },
        {
          type: "divergence",
          content: this.fixture.insights.divergence,
          evidenceMessageIds: pair,
        },
        {
          type: "open_question",
          content: this.fixture.insights.open,
          evidenceMessageIds: [pair[1] ?? ids[ids.length - 1]!],
        },
      ],
    });
  }

  private summaryText(): string {
    const insight = this.fixture.insights;
    return [
      `${insight.consensus}，这一点上没有出现明显的反对。`,
      `没有谈拢的是：${insight.divergence}。`,
      `还悬着的是：${insight.open}。如果要带走一句话：这场讨论没有给出标准答案，但把分歧的位置标出来了。`,
    ].join("\n\n");
  }

  private focusFor(name: string | undefined): string {
    const expert = this.fixture.experts.find((e) => e.name === name);
    if (!expert) return FALLBACK_FOCUS;
    return Array.from(expert.stanceAxis).slice(0, 18).join("");
  }

  private usage(request: LlmJsonRequest<unknown>, raw: string) {
    return {
      inputTokens:
        estimateTokens(request.prompt.system) + estimateTokens(request.prompt.user),
      outputTokens: estimateTokens(raw),
    };
  }

  private record(
    kind: PromptKind,
    request: { prompt: { id?: string; includedMessageIds?: string[] } },
    attempt: number,
    ok: boolean,
    started: number,
    inputTokens: number,
    outputTokens: number,
  ): void {
    this.calls.push({
      promptKind: kind,
      promptId: request.prompt.id,
      scenario: this.scenario,
      attempt,
      ok,
      latencyMs: Date.now() - started,
      includedMessageIds: request.prompt.includedMessageIds ?? [],
      inputTokens,
      outputTokens,
    });
  }

  get lastSpeechText(): string {
    return this.lastSpeech;
  }
}

export function createMockClient(options: MockClientOptions = {}): MockLLMClient {
  return new MockLLMClient(options);
}

/**
 * 从会话快照 + 候选集构造 `LlmMockMeta`。
 * eval 与单测都用这个，避免各处手搓 meta。
 */
export function buildMockMeta(
  snapshot: DiscussionSnapshot,
  extra: Partial<LlmMockMeta> = {},
): LlmMockMeta {
  return {
    discussionId: snapshot.discussionId,
    scenario: extra.scenario ?? "normal",
    turnIndex: snapshot.turnCount + 1,
    expertCount: snapshot.expertCount,
    roster: snapshot.experts.map((e) => ({ id: e.id, role: e.role, name: e.name })),
    messageIds: snapshot.messages.map((m) => m.id),
    messageSpeakerIds: snapshot.messages.map((m) => m.expertId),
    previousContent: snapshot.messages.at(-1)?.content,
    insights: snapshot.insights.map((i) => ({ id: i.id, type: i.type, content: i.content })),
    topic: snapshot.topic,
    ...extra,
  };
}

/**
 * 从历史里挑一对"不同发言者"的证据；优先挑非主持人之间的组合。
 * 全量快照的共识/分歧要求 ≥2 位不同发言者，mock 必须自己先满足这条。
 */function pickEvidencePair(
  ids: string[],
  speakers: string[],
  hostIds: Set<string>,
): [string, string] {
  const last = ids[ids.length - 1]!;
  let fallback: [string, string] | undefined;
  for (let i = ids.length - 1; i > 0; i -= 1) {
    for (let j = i - 1; j >= 0; j -= 1) {
      const si = speakers[i];
      const sj = speakers[j];
      if (!si || !sj || si === sj) continue;
      const pair: [string, string] = [ids[j]!, ids[i]!];
      if (!fallback) fallback = pair;
      if (!hostIds.has(si) && !hostIds.has(sj)) return pair;
    }
  }
  if (fallback) return fallback;
  return [ids[Math.max(0, ids.length - 2)]!, last];
}

function pickTwoSpeakerIds(meta: LlmMockMeta | undefined): string[] {
  const ids = meta?.messageIds ?? [];
  const speakers = meta?.messageSpeakerIds ?? [];
  if (ids.length === 0) return [];
  const chosen: string[] = [];
  const seen = new Set<string>();
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const speaker = speakers[i] ?? `unknown-${i}`;
    if (seen.has(speaker)) continue;
    seen.add(speaker);
    chosen.push(ids[i]!);
    if (chosen.length === 2) break;
  }
  return chosen;
}

function chunkText(text: string, size: number): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += size) {
    chunks.push(chars.slice(i, i + size).join(""));
  }
  return chunks;
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    if (signal?.aborted) return Promise.reject(new LlmError("aborted", "aborted"));
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LlmError("aborted", "aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new LlmError("aborted", "aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
