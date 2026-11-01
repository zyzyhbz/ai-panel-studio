import type { Intent, InsightType, Polarity } from "@ai-panel/shared";

/**
 * LLM 传输层契约（G1 决议 §1.11 的"接口在 agent、传输在 server、mock 在 agent"）。
 *
 * 形状与 `apps/server/src/llm/types.ts` 完全一致——后端把那个文件改成
 * `export * from "@ai-panel/agent"` 即可，mock/DeepSeek client 与调用点都不用改。
 *
 * 本包不读环境变量、不读 Key、不发网络请求。
 */

/** 五类调用的稳定标识（用于日志与 prompt 版本）。 */
export const PROMPT_IDS = [
  "P-ROSTER",
  "P-DECIDE",
  "P-SPEECH",
  "P-INSIGHT",
  "P-SUMMARY",
] as const;

export type PromptId = (typeof PROMPT_IDS)[number];

export const PROMPT_KINDS = [
  "roster",
  "decision",
  "speech",
  "insight",
  "summary",
] as const;

export type PromptKind = (typeof PROMPT_KINDS)[number];

export const PROMPT_ID_TO_KIND: Record<PromptId, PromptKind> = {
  "P-ROSTER": "roster",
  "P-DECIDE": "decision",
  "P-SPEECH": "speech",
  "P-INSIGHT": "insight",
  "P-SUMMARY": "summary",
};

/**
 * 一次 LLM 调用的完整描述。
 *
 * 前 5 个字段是 transport 契约（后端原样转发）；
 * 其余是 agent 侧的元数据，transport 可忽略。
 */
export interface PromptSpec {
  kind: PromptKind;
  system: string;
  user: string;
  responseFormat: "text" | "json_object";
  temperature: number;
  maxOutputTokens: number;

  /** agent 侧：稳定 ID 与版本，写结构化日志，不进事件 payload */
  id?: PromptId;
  version?: string;
  timeoutMs?: number;
  estimatedInputTokens?: number;
  /** 本 prompt 里出现的 transcript messageId，用于 QA_LLM_LOG.includedMessageIds */
  includedMessageIds?: string[];
  /** 本 prompt 是否请求 provider thinking；reasoning 永不进入公开事件。 */
  thinking?: "disabled" | "enabled";
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export type MockScenario =
  | "normal"
  | "slow"
  | "timeout"
  | "invalid-json"
  | "empty"
  | "duplicate"
  | "runaway"
  | "long"
  | "mixed";

export const MOCK_SCENARIOS: readonly MockScenario[] = [
  "normal",
  "slow",
  "timeout",
  "invalid-json",
  "empty",
  "duplicate",
  "runaway",
  "long",
  "mixed",
];

/**
 * 给 mock client 的结构化上下文。
 * 真实 client 忽略它；mock 靠它保持确定性，而不是去解析 prompt 文本。
 */
export interface LlmMockMeta {
  discussionId: string;
  scenario: MockScenario;
  turnIndex: number;
  expertCount: number;
  roster: { id: string; role: "host" | "expert"; name: string }[];
  candidates?: {
    id: string;
    name: string;
    role: "host" | "expert";
    intent: Intent;
    polarity: Polarity;
  }[];
  messageIds?: string[];
  /** 与 messageIds 一一对应的发言者 id，mock 用来挑"不同发言者"的证据 */
  messageSpeakerIds?: string[];
  previousContent?: string;
  insights?: { id: string; type: InsightType; content: string }[];

  /* agent 侧扩展（可选；后端已有实现不传也不受影响） */
  topic?: string;
  speakerId?: string;
  intent?: Intent;
  turnFocus?: string;
  fixtureId?: string;
  /** 本轮合法候选 id（= eligibility.allowedSpeakers），mock 只会从中挑 */
  allowedIds?: string[];
  /** 本轮是否必须收尾 */
  mustClose?: boolean;
}

export interface LlmJsonRequest<T> {
  prompt: PromptSpec;
  signal: AbortSignal;
  timeoutMs: number;
  /** 解析 + 校验；抛错会触发修复重试 */
  parse: (raw: string) => T;
  meta?: LlmMockMeta;
}

export interface LlmJsonResult<T> {
  value: T;
  raw: string;
  usage?: LlmUsage;
  /** 第一次 parse 失败、模型被问了第二次 */
  repaired: boolean;
}

export interface LlmStreamRequest {
  prompt: PromptSpec;
  signal: AbortSignal;
  firstTokenTimeoutMs: number;
  totalTimeoutMs: number;
  meta?: LlmMockMeta;
}

export interface LlmStreamResult {
  usage?: LlmUsage;
}

/**
 * 唯一的 LLM 出口。
 * server 用 DeepSeek transport 实现，agent 用 MockLLMClient 实现。
 */
export interface LLMClient {
  readonly mode: "mock" | "real";
  readonly model: string;
  json<T>(request: LlmJsonRequest<T>): Promise<LlmJsonResult<T>>;
  stream(request: LlmStreamRequest): AsyncGenerator<string, LlmStreamResult, void>;
}

export type LlmErrorKind =
  | "timeout"
  | "invalid_output"
  | "empty_output"
  | "network"
  | "auth"
  | "aborted";

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status?: number;

  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

/** 默认参数（AR-10：默认 deepseek-flash；thinking 按 prompt 分配）。 */
export const DEFAULT_LLM_PARAMS: Record<
  PromptId,
  { temperature: number; maxOutputTokens: number; responseFormat: "text" | "json_object" }
> = {
  "P-ROSTER": { temperature: 0.9, maxOutputTokens: 1200, responseFormat: "json_object" },
  "P-DECIDE": { temperature: 0.3, maxOutputTokens: 240, responseFormat: "json_object" },
  // Thinking is enabled for speech/summary, so the output budget must cover
  // private reasoning + the public 1–2 sentences.
  "P-SPEECH": { temperature: 0.8, maxOutputTokens: 1200, responseFormat: "text" },
  "P-INSIGHT": { temperature: 0.2, maxOutputTokens: 900, responseFormat: "json_object" },
  "P-SUMMARY": { temperature: 0.5, maxOutputTokens: 1400, responseFormat: "text" },
};

/**
 * Per-prompt thinking policy.
 *
 * JSON-only control calls stay off: with a small max_tokens budget the model
 * can spend everything on reasoning and return an empty `content`, which breaks
 * decisions/insights. Expert speech and the host summary get thinking because
 * that is where argument depth actually matters.
 */
export const THINKING_BY_PROMPT: Record<PromptId, "enabled" | "disabled"> = {
  "P-ROSTER": "disabled",
  "P-DECIDE": "disabled",
  "P-SPEECH": "enabled",
  "P-INSIGHT": "disabled",
  "P-SUMMARY": "enabled",
};

/**
 * 超时预算（09-深度讨论 §7：开启 thinking 后要放宽）。
 * decision 45s / speech 90s / insight 45s / summary 90s；首 token 20s。
 */
export const DEFAULT_TIMEOUTS: Record<PromptId, number> = {
  "P-ROSTER": 30_000,
  "P-DECIDE": 45_000,
  "P-SPEECH": 90_000,
  "P-INSIGHT": 45_000,
  "P-SUMMARY": 90_000,
};

/** 发言首 token 超时（流式专用；thinking 模式下首 token 会明显变慢）。 */
export const SPEECH_FIRST_TOKEN_TIMEOUT_MS = 20_000;
