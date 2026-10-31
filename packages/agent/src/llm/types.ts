/**
 * LLM 传输层接口（唯一由 backend 实现的部分）。
 *
 * 分工（G1 决议 1.11）：
 * - 接口、PromptSpec、mock、fixtures   → 本包
 * - 真实 DeepSeek HTTP、超时、重试、Key → apps/server/src/llm
 *
 * 本包不读环境变量、不读 Key、不发网络请求。
 */

export const PROMPT_IDS = [
  "P-ROSTER",
  "P-DECIDE",
  "P-SPEECH",
  "P-INSIGHT",
  "P-SUMMARY",
] as const;

export type PromptId = (typeof PROMPT_IDS)[number];

export type PromptKind = "json" | "text";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface LLMParams {
  /** 由 backend 注入；agent 不写死模型名 */
  model?: string;
  temperature: number;
  maxTokens: number;
  responseFormat: "json_object" | "text";
  /** 实时链路固定 disabled，禁止把隐藏 CoT 带进链路 */
  thinking: "disabled" | "enabled";
}

/**
 * 一次 LLM 调用的完整描述。
 * backend 只需把它原样转发给 transport，无须理解字段语义。
 */
export interface PromptSpec {
  id: PromptId;
  version: string;
  kind: PromptKind;
  messages: ChatMessage[];
  params: LLMParams;
  timeoutMs: number;
  estimatedInputTokens: number;
  /** 本 prompt 里出现的 transcript messageId，用于 QA_LLM_LOG.includedMessageIds */
  includedMessageIds: string[];
}

export interface LLMRequest extends PromptSpec {
  signal?: AbortSignal;
}

/** PromptSpec → LLMRequest，backend 可附加 AbortSignal。 */
export function toLLMRequest(spec: PromptSpec, signal?: AbortSignal): LLMRequest {
  return signal ? { ...spec, signal } : { ...spec };
}

export type FinishReason = "stop" | "length" | "content_filter" | "error";

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LLMResponse {
  text: string;
  finishReason: FinishReason;
  usage?: LLMUsage;
  model?: string;
  latencyMs?: number;
  /** provider 返回了 reasoning_content 且被 adapter 剥离时置 true */
  reasoningStripped?: boolean;
}

export type LLMErrorCode =
  | "timeout"
  | "rate_limited"
  | "unavailable"
  | "aborted"
  | "empty_output"
  | "invalid_output"
  | "not_configured"
  | "unknown";

export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly retryable: boolean;

  constructor(code: LLMErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "LLMError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * 唯一的 LLM 出口。backend 用真实 transport 实现，agent 用 MockLLMClient。
 * `stream` 逐段回调增量文本，返回值是完整响应（含全文）。
 */
export interface LLMClient {
  readonly mode: "mock" | "real";
  readonly name: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest, onDelta: (delta: string) => void): Promise<LLMResponse>;
}

/** 五类调用的默认参数：默认 deepseek-flash + 关闭 thinking（AR-10）。 */
export const DEFAULT_LLM_PARAMS: Record<PromptId, LLMParams> = {
  "P-ROSTER": {
    temperature: 0.9,
    maxTokens: 1200,
    responseFormat: "json_object",
    thinking: "disabled",
  },
  "P-DECIDE": {
    temperature: 0.3,
    maxTokens: 160,
    responseFormat: "json_object",
    thinking: "disabled",
  },
  "P-SPEECH": {
    temperature: 0.8,
    maxTokens: 220,
    responseFormat: "text",
    thinking: "disabled",
  },
  "P-INSIGHT": {
    temperature: 0.2,
    maxTokens: 900,
    responseFormat: "json_object",
    thinking: "disabled",
  },
  "P-SUMMARY": {
    temperature: 0.5,
    maxTokens: 500,
    responseFormat: "text",
    thinking: "disabled",
  },
};

/** 超时预算（与 AGENT-BEHAVIOR §0 常量表一致）。 */
export const DEFAULT_TIMEOUTS: Record<PromptId, number> = {
  "P-ROSTER": 20_000,
  "P-DECIDE": 8_000,
  "P-SPEECH": 20_000,
  "P-INSIGHT": 15_000,
  "P-SUMMARY": 25_000,
};

/** 发言首 token 的超时（仅流式使用）。 */
export const SPEECH_FIRST_TOKEN_TIMEOUT_MS = 6_000;
