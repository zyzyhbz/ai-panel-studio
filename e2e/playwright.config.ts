import path from "node:path";
import { defineConfig } from "@playwright/test";
import { env } from "./helpers/env";

/**
 * AI Panel Studio — E2E 配置（QA owner）
 *
 * 运行方式（必须用项目根目录 wrapper，本机默认 node 是 v20）：
 *   .\scripts\pnpm.ps1 exec playwright test --config e2e/playwright.config.ts
 *
 * 设计要点：
 * 1. 用本机已安装的 Chrome（channel=chrome），不下载 Playwright 浏览器。
 * 2. baseURL 可用 E2E_BASE_URL 覆盖；API 用 E2E_API_URL（默认直连 3001，绕开 Vite 代理）。
 * 3. webServer 由 E2E_WEBSERVER_CMD 控制；默认认为服务已由外部启动。
 * 4. workers=1：后端是单进程 + 单 SQLite，并行会互相污染状态。
 * 5. **产物目录必须是纯 ASCII 绝对路径**（%TEMP%\ai-panel-e2e）：
 *    仓库路径含中文时，trace 写盘会在 cp936 拼接处 ENOENT，导致"不是断言的失败"。
 */
const ARTIFACTS = env.artifactsDir;
/**
 * 每次运行一个独立产物目录。
 *
 * 踩过的坑：两个人同时跑 E2E 时共用 `test-results/`，一方结束时清理目录，
 * 另一方的 trace 文件被删 → `browserContext.close: ENOENT ... .trace`，
 * 表现为"用例失败但不是断言失败"。用 runId 隔离即可。
 */
const RUN_DIR = path.join(ARTIFACTS, env.runId);

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  outputDir: path.join(RUN_DIR, "test-results"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: env.ci,
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(ARTIFACTS, "results.json") }],
    ["html", { outputFolder: path.join(RUN_DIR, "report"), open: "never" }],
  ],
  use: {
    baseURL: env.baseURL,
    channel: "chrome",
    headless: !env.headed,
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    extraHTTPHeaders: { "x-qa-run": env.runId },
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chrome",
      use: { channel: "chrome" },
    },
  ],
  // webServer 由环境变量控制：
  //   $env:E2E_WEBSERVER_CMD=".\scripts\pnpm.ps1 dev"; playwright test
  // 不设时默认"外部已起服务"，避免 Playwright 用错 node 起进程。
  // E2E_STRICT=1 时应用不可达会直接失败，不会静默跳过。
  webServer: process.env.E2E_WEBSERVER_CMD
    ? [
        {
          command: process.env.E2E_WEBSERVER_CMD,
          url: env.baseURL,
          cwd: env.repoRoot,
          reuseExistingServer: true,
          timeout: 120_000,
          stdout: "pipe",
          stderr: "pipe",
        },
      ]
    : undefined,
});
