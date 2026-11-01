import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../../src/config/env";
import { buildApp, type BuiltApp } from "../../src/app";
import { openDb } from "../../src/db/connection";
import { migrate } from "../../src/db/migrate";
import type { LLMClient } from "../../src/llm/types";

export interface TestConfigOverrides {
  llm?: Omit<Partial<AppConfig["llm"]>, "timeouts"> & {
    timeouts?: Partial<AppConfig["llm"]["timeouts"]>;
  };
  sse?: Partial<AppConfig["sse"]>;
  session?: Partial<AppConfig["session"]>;
  mock?: Partial<AppConfig["mock"]>;
  databasePath?: string;
  llmMode?: "mock" | "real";
}

/** Config that never touches the real env, real Key or the real database file. */
export function makeTestConfig(overrides: TestConfigOverrides = {}): AppConfig {
  const base: AppConfig = {
    nodeEnv: "test",
    isTest: true,
    port: 0,
    host: "127.0.0.1",
    logLevel: "silent",
    databasePath: ":memory:",
    llm: {
      mode: overrides.llmMode ?? "mock",
      baseUrl: "http://127.0.0.1:1",
      model: "mock-flash",
      thinking: "disabled",
      maxConcurrency: 4,
      firstTokenTimeoutMs: 1_500,
      timeouts: {
        roster: 2_000,
        decision: 800,
        speech: 1_500,
        insight: 1_500,
        summary: 2_000,
      },
    },
    mock: { delayMs: 0, qaLogPath: "" },
    sse: { heartbeatMs: 200, retryMs: 100, maxConnections: 8, replayLimit: 5_000 },
    session: { watchdogMs: 60_000, endGraceMs: 1_000 },
    rateLimit: { enabled: false, perMinute: 30 },
    seedOnStart: false,
    warnings: [],
  };
  return {
    ...base,
    databasePath: overrides.databasePath ?? base.databasePath,
    llm: {
      ...base.llm,
      ...(overrides.llm ?? {}),
      timeouts: { ...base.llm.timeouts, ...(overrides.llm?.timeouts ?? {}) },
    },
    mock: { ...base.mock, ...(overrides.mock ?? {}) },
    sse: { ...base.sse, ...(overrides.sse ?? {}) },
    session: { ...base.session, ...(overrides.session ?? {}) },
  };
}

export interface TestApp extends BuiltApp {
  dir: string;
  dbPath: string;
  dispose(): Promise<void>;
}

export async function createTestApp(
  options: { seed?: boolean; config?: TestConfigOverrides; llm?: LLMClient } = {},
): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), "ai-panel-test-"));
  const dbPath = join(dir, "test.db");
  const db = openDb({ path: dbPath });
  migrate(db);

  if (options.seed) {
    const { seed } = await import("../../src/db/seed-data");
    seed(db);
  }

  const config = makeTestConfig({ ...(options.config ?? {}), databasePath: dbPath });
  const built = await buildApp({
    config,
    db,
    recover: false,
    logger: false,
    ...(options.llm ? { llm: options.llm } : {}),
  });

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    await built.close();
    try {
      db.close();
    } catch {
      /* already closed */
    }
    rmSync(dir, { recursive: true, force: true });
  };

  return { ...built, dir, dbPath, dispose };
}

export function parseSseFrames(raw: string): Array<{
  id: number | null;
  event: string;
  data: string;
}> {
  const frames: Array<{ id: number | null; event: string; data: string }> = [];
  for (const block of raw.split("\n\n")) {
    const lines = block.split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    let id: number | null = null;
    let event = "message";
    let data = "";
    let isComment = true;
    for (const line of lines) {
      if (line.startsWith(":")) {
        isComment = true;
        continue;
      }
      isComment = false;
      if (line.startsWith("id:")) id = Number.parseInt(line.slice(3).trim(), 10);
      else if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (isComment) continue;
    frames.push({ id, event, data });
  }
  return frames;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

export async function waitFor<T>(
  probe: () => T | null | undefined | false,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 50;
  const startedAt = Date.now();
  let last: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    const value = probe();
    if (value) return value;
    last = value;
    await sleep(intervalMs);
  }
  throw new Error(`waitFor timed out${options.label ? `: ${options.label}` : ""} (last=${String(last)})`);
}
