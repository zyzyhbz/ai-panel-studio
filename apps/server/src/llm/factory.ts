import type { AppConfig } from "../config/env";
import { createDeepseekClient } from "./deepseek";
import { createMockLlmClient } from "./mock";
import type { LLMClient, MockScenario } from "./types";
import { MOCK_SCENARIOS } from "./types";

/** Whitelist for the `x-qa-scenario` header (mock mode only, docs/06 §1.9). */
export function resolveScenario(raw: string | string[] | undefined): MockScenario {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return "normal";
  const candidate = value.trim().toLowerCase();
  return (MOCK_SCENARIOS as readonly string[]).includes(candidate)
    ? (candidate as MockScenario)
    : "normal";
}

export function createLlmClient(config: AppConfig): LLMClient {
  if (config.llm.mode === "real") {
    if (!config.llm.apiKey) {
      // Guaranteed by loadConfig(), kept as a second line of defence.
      throw new Error("LLM_MODE=real 但缺少 DEEPSEEK_API_KEY");
    }
    return createDeepseekClient({
      apiKey: config.llm.apiKey,
      baseUrl: config.llm.baseUrl,
      model: config.llm.model,
      thinking: config.llm.thinking,
    });
  }
  return createMockLlmClient({
    model: `mock:${config.llm.model}`,
    delayMs: config.mock.delayMs,
    qaLogPath: config.mock.qaLogPath,
  });
}
