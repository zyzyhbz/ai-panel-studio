import OpenAI from "openai";
import type { AppConfig } from "../config/env";
import type {
  LLMClient,
  LlmJsonRequest,
  LlmJsonResult,
  LlmStreamRequest,
  LlmStreamResult,
  PromptSpec,
} from "./types";
import { LlmError } from "./types";

/**
 * Real DeepSeek transport (OpenAI-compatible).
 *
 * Ownership (docs/06 §1.11): the Key, the network call, timeouts, retries and
 * error mapping live here — in the server. `packages/agent` never sees a Key.
 *
 * TODO(verify): the exact request field that disables thinking is not documented
 * in our material. We send `thinking: { type: "disabled" }` (the documented shape
 * for the toggle in the OpenAI-compatible surface). If the API rejects it, set
 * DEEPSEEK_THINKING=enabled — that omits the field entirely and is the escape hatch.
 */
export interface DeepseekConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  thinking: "enabled" | "disabled";
}

function combineSignals(signals: AbortSignal[]): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") return anyFn(signals);
  // Fallback for older runtimes: manual fan-in.
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

function timeoutSignal(ms: number): AbortSignal {
  const anySignal = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  if (typeof anySignal.timeout === "function") return anySignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("timeout")), ms).unref?.();
  return controller.signal;
}

function classify(error: unknown, signal: AbortSignal): LlmError {
  if (signal.aborted) return new LlmError("timeout", "模型响应超时", undefined);
  if (error instanceof LlmError) return error;
  const status = (error as { status?: number }).status;
  if (status === 401 || status === 403) {
    return new LlmError("auth", "模型鉴权失败", status);
  }
  if (typeof status === "number" && status >= 500) {
    return new LlmError("network", "模型服务暂时不可用", status);
  }
  if (typeof status === "number") {
    return new LlmError("network", `模型请求失败 (${status})`, status);
  }
  return new LlmError("network", "模型请求失败", undefined);
}

function describe(spec: PromptSpec): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: spec.system },
    { role: "user", content: spec.user },
  ];
}

/**
 * Build the chat-completions request body. Pure + exported so the thinking/timeout
 * configuration can be asserted in tests without any network call.
 *
 * Thinking policy (docs/09 §7):
 * - `enabled`  → send NO toggle at all; the provider's default is thinking on.
 * - `disabled` → send the explicit off field.
 * If a provider rejects the field, switch to `enabled` (omit) and record that.
 */
export function buildChatBody(input: {
  model: string;
  thinking: "enabled" | "disabled";
  spec: PromptSpec;
  json: boolean;
  messages: unknown[];
}): Record<string, unknown> {
  const { model, thinking, spec, json, messages } = input;
  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature: spec.temperature,
    max_tokens: spec.maxOutputTokens,
    stream: !json,
  };
  if (json) payload.response_format = { type: "json_object" };
  if (thinking === "disabled") payload.thinking = { type: "disabled" };
  return payload;
}

/**
 * Resolve the thinking toggle for one request.
 *
 * - a global `disabled` always wins (operator escape hatch / cheaper runs);
 * - otherwise the prompt decides per call (`spec.thinking`), defaulting to on.
 *
 * This is why SPEECH/SUMMARY can run with thinking on while DECIDE/INSIGHT/ROSTER
 * stay off: reasoning would eat their small `max_tokens` budget.
 */
export function resolveThinking(
  configThinking: "enabled" | "disabled",
  specThinking: "enabled" | "disabled" | undefined,
): "enabled" | "disabled" {
  if (configThinking === "disabled") return "disabled";
  return specThinking ?? "enabled";
}

export function createDeepseekClient(config: DeepseekConfig): LLMClient {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    maxRetries: 0,
    timeout: 120_000,
  });

  function body(spec: PromptSpec, json: boolean, messages: unknown[]): Record<string, unknown> {
    return buildChatBody({
      model: config.model,
      thinking: resolveThinking(config.thinking, spec.thinking),
      spec,
      json,
      messages,
    });
  }

  return {
    mode: "real",
    model: config.model,

    async json<T>(request: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
      const signal = combineSignals([request.signal, timeoutSignal(request.timeoutMs)]);
      const messages: { role: "system" | "user" | "assistant"; content: string }[] = describe(
        request.prompt,
      );
      let lastRaw = "";

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const completion = (await client.chat.completions.create(
            body(request.prompt, true, messages) as never,
            { signal },
          )) as {
            choices: { message?: { content?: string | null } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const raw = completion.choices[0]?.message?.content ?? "";
          lastRaw = raw;
          if (raw.trim().length === 0) {
            throw new LlmError("empty_output", "模型返回空内容");
          }
          try {
            const value = request.parse(raw);
            return {
              value,
              raw,
              repaired: attempt > 1,
              usage: {
                inputTokens: completion.usage?.prompt_tokens ?? 0,
                outputTokens: completion.usage?.completion_tokens ?? 0,
              },
            };
          } catch (parseError) {
            if (attempt === 2) {
              throw new LlmError(
                "invalid_output",
                `模型输出无法解析: ${(parseError as Error).message}`,
              );
            }
            // Repair retry: hand the model its own output plus the failure reason.
            messages.push({ role: "assistant", content: raw });
            messages.push({
              role: "user",
              content:
                "上一次输出无法按约定的 JSON 解析。请只输出合法 JSON 对象，不要 markdown、不要解释。",
            });
          }
        } catch (error) {
          const mapped = classify(error, signal);
          const retryable = mapped.kind === "network" && (mapped.status ?? 0) !== 401;
          if (attempt === 1 && retryable) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            continue;
          }
          throw mapped;
        }
      }
      throw new LlmError("invalid_output", `模型输出无法解析: ${lastRaw.slice(0, 80)}`);
    },

    async *stream(
      request: LlmStreamRequest,
    ): AsyncGenerator<string, LlmStreamResult, void> {
      const outer = combineSignals([request.signal, timeoutSignal(request.totalTimeoutMs)]);
      const firstToken = new AbortController();
      const firstTokenTimer = setTimeout(
        () => firstToken.abort(new Error("first-token timeout")),
        request.firstTokenTimeoutMs,
      );
      const signal = combineSignals([outer, firstToken.signal]);
      let produced = "";
      let usage: LlmStreamResult["usage"];

      try {
        const stream = (await client.chat.completions.create(
          body(request.prompt, false, describe(request.prompt)) as never,
          { signal },
        )) as unknown as AsyncIterable<{
          choices: { delta?: { content?: string | null } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
        }>;

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            clearTimeout(firstTokenTimer);
            produced += delta;
            yield delta;
          }
          if (chunk.usage) {
            usage = {
              inputTokens: chunk.usage.prompt_tokens ?? 0,
              outputTokens: chunk.usage.completion_tokens ?? 0,
            };
          }
        }
      } catch (error) {
        if (produced.length === 0) throw classify(error, signal);
        // Partial stream: keep what we have; the caller decides to retry/degrade.
        return { usage };
      } finally {
        clearTimeout(firstTokenTimer);
      }

      if (produced.trim().length === 0) {
        throw new LlmError("empty_output", "模型返回空内容");
      }
      return { usage };
    },
  };
}

export type { AppConfig };
