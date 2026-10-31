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
 * 3. 默认不启动 webServer：G2 期间前后端可能未就绪，由 E2E_WEB_SERVER=1 显式开启。
 * 4. workers=1：后端是单进程 + 单 SQLite，并行会互相污染状态。
 * 5. 所有产物写到 e2e/.artifacts（已 gitignore），失败保留 trace + 截图。
 */
export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  outputDir: "./.artifacts/test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: env.ci,
  reporter: [
    ["list"],
    ["json", { outputFile: "./.artifacts/results.json" }],
    ["html", { outputFolder: "./.artifacts/report", open: "never" }],
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
  // 不配 webServer：本机 dev 服务需用 .\scripts\pnpm.ps1 dev 手动启动（Node 24 + 清代理），
  // 由 Playwright 代起会用到错误 node。E2E_STRICT=1 时若应用不可达会直接失败，不会静默跳过。
});
