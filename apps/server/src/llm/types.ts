import type { Intent, InsightType, Polarity } from "@ai-panel/shared";

/**
 * Transport-level LLM contract.
 *
 * Contract v1.0 (docs/06 §1.11) puts `LLMClient` in `packages/agent` (AI owner)
 * with the real transport in `apps/server`. AI-02 has not published it yet, so
 * this is the local same-shape interface. When `@ai-panel/agent` exports
 * `LLMClient`, replace this file with a re-export — the mock and the DeepSeek
 * client both implement it, and no call site changes.
 */

export type PromptKind = "roster" | "decision" | "speech" | "insight" | "summary";

export interface PromptSpec {
  kind: PromptKind;
  system: string;
  user: string;
  responseFormat: "text" | "json_object";
  temperature: number;
  maxOutputTokens: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Structured context for the mock client only — the real client ignores it.
 * This keeps the mock deterministic instead of parsing prompt text.
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
  previousContent?: string;
  insights?: { id: string; type: InsightType; content: string }[];
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

export interface LlmJsonRequest<T> {
  prompt: PromptSpec;
  signal: AbortSignal;
  timeoutMs: number;
  /** Parses + validates. Throws to trigger the repair-retry path. */
  parse: (raw: string) => T;
  meta?: LlmMockMeta;
}

export interface LlmJsonResult<T> {
  value: T;
  raw: string;
  usage?: LlmUsage;
  /** True when the model had to be asked twice (parse failure on attempt 1). */
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

export interface LLMClient {
  readonly mode: "mock" | "real";
  readonly model: string;
  json<T>(request: LlmJsonRequest<T>): Promise<LlmJsonResult<T>>;
  stream(request: LlmStreamRequest): AsyncGenerator<string, LlmStreamResult, void>;
}

export class LlmError extends Error {
  constructor(
    readonly kind: "timeout" | "invalid_output" | "empty_output" | "network" | "auth" | "aborted",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
