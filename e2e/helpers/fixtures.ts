import { test as base, expect, type Page } from "@playwright/test";
import { ApiClient } from "./api";
import { attachDiagnostics, type Diagnostics } from "./dom";
import { probeBackend, probeUi, type BackendCaps, type UiCaps } from "./capabilities";
import { env } from "./env";

/**
 * 扩展 Playwright 的 `test`：
 * - `api`：Node 侧 API client（与 UI 断言同源）
 * - `backend` / `ui`：能力矩阵（决定 skip 还是跑）
 * - `diag`：console / pageerror / 请求失败收集器
 *
 * 约定：能力缺失一律 skip 并写清原因；`E2E_STRICT=1` 时改为直接失败（发版门禁用）。
 */

interface QaFixtures {
  api: ApiClient;
  backend: BackendCaps;
  ui: UiCaps;
  diag: Diagnostics;
}

let uiCache: UiCaps | null = null;

async function getUi(page: Page): Promise<UiCaps> {
  if (uiCache && process.env.E2E_REFRESH_CAPS !== "1") return uiCache;
  uiCache = await probeUi(page);
  return uiCache;
}

export const test = base.extend<QaFixtures>({
  api: async ({}, use) => {
    await use(new ApiClient());
  },

  backend: async ({}, use) => {
    await use(await probeBackend());
  },

  ui: async ({ page }, use) => {
    await use(await getUi(page));
  },

  diag: async ({ page }, use) => {
    await use(attachDiagnostics(page));
  },
});

export { expect };

/**
 * 依赖门：能力缺失时跳过（strict 模式下失败）。
 * 必须在测试体开头调用。
 */
export function requireCap(caps: UiCaps, cap: keyof UiCaps): void {
  if (caps[cap] === true) return;
  const reason = caps.reasons[String(cap)] ?? `${String(cap)} 未就绪`;
  if (env.strict) {
    throw new Error(`[E2E_STRICT] 缺少能力 ${String(cap)}：${reason}`);
  }
  test.skip(true, `未就绪：${String(cap)} —— ${reason}`);
}

/** 简易的唯一议题生成器：避免不同用例互相污染同名数据。 */
export function uniqueTopic(base: string): string {
  return `${base}（${env.runId}-${Math.random().toString(36).slice(2, 6)}）`;
}
