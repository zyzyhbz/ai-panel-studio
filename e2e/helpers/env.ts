import os from "node:os";
import path from "node:path";

/**
 * E2E 运行环境解析。所有可变项集中在这里，测试代码里不再直接读 process.env。
 */

const E2E_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(E2E_ROOT, "..");

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function flag(name: string): boolean {
  return process.env[name] === "1";
}

export const env = {
  /** 前端地址。Vite dev 默认 5173。 */
  baseURL: str("E2E_BASE_URL", "http://127.0.0.1:5173"),
  /** 后端地址。直连 3001，避免依赖 Vite 代理是否可用。 */
  apiURL: str("E2E_API_URL", "http://127.0.0.1:3001"),
  /**
   * 严格模式：能力探测失败（应用不可达、契约字段缺失）直接抛错，而不是 skip。
   * 发版门禁必须 E2E_STRICT=1；G2 开发期默认 0，便于"应用没起也能收集结构信息"。
   */
  strict: flag("E2E_STRICT"),
  headed: flag("E2E_HEADED"),
  ci: process.env.CI !== undefined,
  /** 本次运行标识，写进请求头与产物目录，便于和日志对齐。 */
  runId: `qa-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`,
  e2eRoot: E2E_ROOT,
  repoRoot: REPO_ROOT,
  fixturesDir: path.join(E2E_ROOT, "fixtures"),
  /**
   * 产物目录必须是**纯 ASCII 绝对路径**。
   *
   * 踩过的坑：仓库路径含中文（`D:\AI开发\...`），Playwright 把 trace 写到
   * `e2e/.artifacts/...` 后，在 browserContext.close 阶段按 cp936 拼路径导致
   * `ENOENT: D:\AI寮€鍙慭...`，整套用例因此失败——不是断言失败，是路径编码失败。
   *
   * 默认放到系统临时目录（纯 ASCII）：%TEMP%\ai-panel-e2e。
   * 可用 E2E_ARTIFACTS_DIR 覆盖，但请保持 ASCII。
   */
  artifactsDir: str("E2E_ARTIFACTS_DIR", path.join(os.tmpdir(), "ai-panel-e2e")),
  /** 后端 SQLite 路径（只读断言用），与 .env.example 的 DATABASE_PATH 对齐。 */
  dbPath: str("E2E_DB_PATH", path.join(REPO_ROOT, "data", "app.db")),
  /** 后端日志文件（可选）；不存在时日志断言走 skip。 */
  logPath: str("E2E_LOG_PATH", path.join(REPO_ROOT, "data", "logs", "server.log")),
  /** 每个能力探测/等待的软超时，应用没起时能快速失败而不是挂 30s。 */
  probeTimeoutMs: Number(str("E2E_PROBE_TIMEOUT_MS", "2500")),
} as const;

export function apiUrl(p: string): string {
  return `${env.apiURL}${p.startsWith("/") ? p : `/${p}`}`;
}

export function webUrl(p = "/"): string {
  return new URL(p, env.baseURL).toString();
}
