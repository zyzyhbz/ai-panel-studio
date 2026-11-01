import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

/** Walk up until we find the pnpm workspace root. Works from src/ and dist/. */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot(import.meta.dirname);

export function loadEnvFiles(): void {
  for (const name of [".env.local", ".env"]) {
    const file = resolve(REPO_ROOT, name);
    if (existsSync(file)) {
      loadDotenv({ path: file, quiet: true });
      return;
    }
  }
}

const booleanish = z
  .string()
  .transform((v) => v === "1" || v.toLowerCase() === "true")
  .pipe(z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().min(1).default("127.0.0.1"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_PATH: z.string().min(1).default("./data/app.db"),

  LLM_MODE: z.enum(["mock", "real"]).optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-flash"),
  // docs/09 §7: real mode runs with thinking ON. `enabled` means we do not send the
  // provider toggle at all (thinking is the provider default); `disabled` sends the
  // explicit off field.
  DEEPSEEK_THINKING: z.enum(["enabled", "disabled"]).default("enabled"),
  // Deep thinking budgets (docs/09 §7): decision 45s, speech 90s, insight 45s,
  // summary 90s, roster 60s; first token within 20s or the turn degrades.
  LLM_TIMEOUT_ROSTER_MS: z.coerce.number().int().min(1_000).default(60_000),
  LLM_TIMEOUT_DECISION_MS: z.coerce.number().int().min(500).default(45_000),
  LLM_TIMEOUT_SPEECH_MS: z.coerce.number().int().min(1_000).default(90_000),
  LLM_TIMEOUT_INSIGHT_MS: z.coerce.number().int().min(1_000).default(45_000),
  LLM_TIMEOUT_SUMMARY_MS: z.coerce.number().int().min(1_000).default(90_000),
  LLM_FIRST_TOKEN_MS: z.coerce.number().int().min(1_000).default(20_000),
  LLM_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),

  MOCK_DELAY_MS: z.coerce.number().int().min(0).max(2_000).default(0),
  QA_LLM_LOG: z.string().default("./data/qa-llm.jsonl"),

  SSE_HEARTBEAT_MS: z.coerce.number().int().min(50).default(15_000),
  SSE_RETRY_MS: z.coerce.number().int().min(0).default(1_000),
  SSE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(64).default(8),
  SSE_REPLAY_LIMIT: z.coerce.number().int().min(1).default(5_000),

  SESSION_WATCHDOG_MS: z.coerce.number().int().min(1_000).default(90_000),
  END_GRACE_MS: z.coerce.number().int().min(0).max(10_000).default(3_000),
  RATE_LIMIT_ENABLED: booleanish.default(false),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(30),

  SEED_ON_START: booleanish.default(false),
});

export type RawEnv = z.infer<typeof envSchema>;

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  isTest: boolean;
  port: number;
  host: string;
  logLevel: RawEnv["LOG_LEVEL"];
  databasePath: string;
  llm: {
    mode: "mock" | "real";
    apiKey?: string;
    baseUrl: string;
    model: string;
    thinking: "enabled" | "disabled";
    maxConcurrency: number;
    /** First streamed token budget (docs/09 §7: 20s). */
    firstTokenTimeoutMs: number;
    timeouts: {
      roster: number;
      decision: number;
      speech: number;
      insight: number;
      summary: number;
    };
  };
  mock: { delayMs: number; qaLogPath: string };
  sse: {
    heartbeatMs: number;
    retryMs: number;
    maxConnections: number;
    replayLimit: number;
  };
  session: { watchdogMs: number; endGraceMs: number };
  rateLimit: { enabled: boolean; perMinute: number };
  seedOnStart: boolean;
  warnings: string[];
}

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly code: "LLM_NOT_CONFIGURED" | "INVALID_CONFIG",
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Resolve runtime config from process.env.
 *
 * Deliberate deviation from 06 §1.9 (flagged to PM): an *unset* LLM_MODE in a
 * non-production environment defaults to `mock` with a loud warning instead of
 * failing the boot, so `pnpm dev` works on a fresh clone without .env.local.
 * An *invalid* value always fails, and `real` without a key always fails.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ConfigError(`环境变量不合法: ${detail}`, "INVALID_CONFIG");
  }
  const raw = parsed.data;
  const warnings: string[] = [];

  let mode = raw.LLM_MODE;
  if (!mode) {
    if (raw.NODE_ENV === "production") {
      throw new ConfigError(
        "LLM_MODE 未设置。生产环境必须显式配置 LLM_MODE=mock|real。",
        "LLM_NOT_CONFIGURED",
      );
    }
    mode = "mock";
    warnings.push(
      "LLM_MODE 未设置，已默认 mock（非生产环境）。请在 .env.local 中显式设置。",
    );
  }

  if (mode === "real" && !raw.DEEPSEEK_API_KEY) {
    throw new ConfigError(
      "LLM_MODE=real 但 DEEPSEEK_API_KEY 为空。请在 .env.local 中配置 Key，或改用 LLM_MODE=mock。",
      "LLM_NOT_CONFIGURED",
    );
  }

  const databasePath = isAbsolute(raw.DATABASE_PATH)
    ? raw.DATABASE_PATH
    : resolve(REPO_ROOT, raw.DATABASE_PATH);
  const qaLogPath = isAbsolute(raw.QA_LLM_LOG)
    ? raw.QA_LLM_LOG
    : resolve(REPO_ROOT, raw.QA_LLM_LOG);

  return {
    nodeEnv: raw.NODE_ENV,
    isTest: raw.NODE_ENV === "test",
    port: raw.PORT,
    host: raw.HOST,
    logLevel: raw.LOG_LEVEL,
    databasePath,
    llm: {
      mode,
      apiKey: raw.DEEPSEEK_API_KEY || undefined,
      baseUrl: raw.DEEPSEEK_BASE_URL,
      model: raw.DEEPSEEK_MODEL,
      thinking: raw.DEEPSEEK_THINKING,
      maxConcurrency: raw.LLM_MAX_CONCURRENCY,
      firstTokenTimeoutMs: raw.LLM_FIRST_TOKEN_MS,
      timeouts: {
        roster: raw.LLM_TIMEOUT_ROSTER_MS,
        decision: raw.LLM_TIMEOUT_DECISION_MS,
        speech: raw.LLM_TIMEOUT_SPEECH_MS,
        insight: raw.LLM_TIMEOUT_INSIGHT_MS,
        summary: raw.LLM_TIMEOUT_SUMMARY_MS,
      },
    },
    mock: { delayMs: raw.MOCK_DELAY_MS, qaLogPath },
    sse: {
      heartbeatMs: raw.SSE_HEARTBEAT_MS,
      retryMs: raw.SSE_RETRY_MS,
      maxConnections: raw.SSE_MAX_CONNECTIONS,
      replayLimit: raw.SSE_REPLAY_LIMIT,
    },
    session: { watchdogMs: raw.SESSION_WATCHDOG_MS, endGraceMs: raw.END_GRACE_MS },
    rateLimit: { enabled: raw.RATE_LIMIT_ENABLED, perMinute: raw.RATE_LIMIT_PER_MINUTE },
    seedOnStart: raw.SEED_ON_START,
    warnings,
  };
}
