import type { Page } from "@playwright/test";
import { api } from "./api";
import { env } from "./env";
import { SEL, detectConvention } from "./selectors";

/**
 * 能力探测：把"应用现在能测什么"变成显式数据，而不是靠测试超时去猜。
 *
 * 用法：
 *   test.skip(!caps.web.reachable, caps.reason("web"));
 *
 * 为什么要这层：G2 期间前端还在爬坡（首页/创建/演播厅分三批交付），
 * 直接写死断言会让 E2E 长期红着，团队就会开始忽略红。
 * 显式 skip + 原因，配合 E2E_STRICT=1 在门禁时把 skip 变成失败。
 */

export interface BackendCaps {
  reachable: boolean;
  status: number | null;
  llmMode: string | null;
  dbReady: boolean | null;
  error: string | null;
  /** 后端版本，便于确认测的是同一份构建。 */
  version: string | null;
}

export interface UiCaps {
  web: boolean;
  hasRoot: boolean;
  createForm: boolean;
  roster: boolean;
  stage: boolean;
  replay: boolean;
  qaSse: boolean;
  /** 前端当前用的 testid 约定（用于缺陷单里写清楚）。 */
  convention: "static-data" | "interpolated" | "mixed" | "unknown";
  /** 探测时实际发现的 testid 样本（最多 20 个）。 */
  testids: string[];
  reasons: Record<string, string>;
}

let backendCache: BackendCaps | null = null;

export async function probeBackend(force = false): Promise<BackendCaps> {
  if (backendCache && !force) return backendCache;
  try {
    const res = await api.health({ timeoutMs: env.probeTimeoutMs });
    const body = res.body as Record<string, unknown> | null;
    backendCache = {
      reachable: res.status === 200,
      status: res.status,
      llmMode: typeof body?.["llmMode"] === "string" ? (body["llmMode"] as string) : null,
      dbReady: typeof body?.["dbReady"] === "boolean" ? (body["dbReady"] as boolean) : null,
      version: typeof body?.["version"] === "string" ? (body["version"] as string) : null,
      error: res.status === 200 ? null : `health 返回 ${res.status}`,
    };
  } catch (err) {
    backendCache = {
      reachable: false,
      status: null,
      llmMode: null,
      dbReady: null,
      version: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return backendCache;
}

/** 探测 UI 能力：需要真实浏览器页面（testid 只有渲染后才存在）。 */
export async function probeUi(page: Page): Promise<UiCaps> {
  const caps: UiCaps = {
    web: false,
    hasRoot: false,
    createForm: false,
    roster: false,
    stage: false,
    replay: false,
    qaSse: false,
    convention: "unknown",
    testids: [],
    reasons: {},
  };

  let rootHtml = "";
  try {
    const res = await page.goto("/", { waitUntil: "domcontentloaded", timeout: 10_000 });
    caps.web = res !== null && res.status() < 400;
    caps.hasRoot = (await page.locator("#root").count()) > 0;
    rootHtml = await page.content();
    if (!caps.web) caps.reasons["web"] = `首页返回 ${res?.status() ?? "no-response"}`;
  } catch (err) {
    caps.reasons["web"] = `首页不可达：${err instanceof Error ? err.message : String(err)}`;
    return caps;
  }

  const count = async (selector: string) => {
    try {
      return await page.locator(selector).count();
    } catch {
      return 0;
    }
  };

  caps.testids = await page.$$eval("[data-testid]", (els) =>
    Array.from(new Set(els.map((e) => e.getAttribute("data-testid") ?? ""))).slice(0, 40),
  );
  caps.convention = detectConvention(caps.testids);
  caps.qaSse = await page.evaluate(() => {
    const w = window as unknown as { __qa?: { sse?: unknown } };
    return typeof w.__qa?.sse !== "undefined";
  });

  // 创建页
  try {
    await page.goto("/new", { waitUntil: "domcontentloaded", timeout: 10_000 });
    caps.createForm = (await count(SEL.createTopic)) > 0;
    if (!caps.createForm) {
      caps.reasons["createForm"] = rootHtml.includes("id=\"root\"")
        ? "路由 /new 未实现（FE-03 未交付）"
        : "/new 未渲染 React 根节点";
    }
  } catch (err) {
    caps.reasons["createForm"] = `打开 /new 失败：${err instanceof Error ? err.message : String(err)}`;
  }

  // 演播厅 / 回放：需要一条真实 discussion
  const list = await api.listDiscussions({ limit: 1 }, { timeoutMs: env.probeTimeoutMs });
  const items = (list.body as { items?: Array<{ id?: string; status?: string }> } | null)?.items ?? [];
  const first = items.find((i) => typeof i?.id === "string");
  if (!first?.id) {
    caps.reasons["stage"] = "后端无可用 discussion（未迁移/未 seed/接口未实现）";
    caps.reasons["replay"] = caps.reasons["stage"]!;
  } else {
    try {
      await page.goto(`/d/${first.id}`, { waitUntil: "domcontentloaded", timeout: 10_000 });
      caps.stage = (await count(SEL.panel)) > 0 || (await count(SEL.transcriptList)) > 0;
      if (!caps.stage) caps.reasons["stage"] = `路由 /d/${first.id} 未渲染演播厅（FE-04 未交付）`;
    } catch (err) {
      caps.reasons["stage"] = `打开演播厅失败：${err instanceof Error ? err.message : String(err)}`;
    }
    try {
      await page.goto(`/d/${first.id}/replay`, { waitUntil: "domcontentloaded", timeout: 10_000 });
      caps.replay = (await count(SEL.replayControls)) > 0;
      if (!caps.replay) caps.reasons["replay"] = `路由 /d/${first.id}/replay 未渲染回放（FE-05 未交付）`;
    } catch (err) {
      caps.reasons["replay"] = `打开回放失败：${err instanceof Error ? err.message : String(err)}`;
    }
  }

  if (!caps.qaSse) {
    caps.reasons["qaSse"] = "window.__qa.sse 未暴露（06 §1.9 未实现，SSE 断言先用 Node 直连）";
  }
  return caps;
}

/** 生成一段人读的能力矩阵，写进报告与 stdout。 */
export function formatCaps(backend: BackendCaps, ui: UiCaps | null): string {
  const line = (k: string, v: string) => `  ${k.padEnd(16)} ${v}`;
  const rows = [
    "能力探测（E2E capability matrix）",
    line("api", `${backend.reachable ? "OK" : "DOWN"} llmMode=${backend.llmMode ?? "?"} dbReady=${backend.dbReady ?? "?"} version=${backend.version ?? "?"}${backend.error ? ` err=${backend.error}` : ""}`),
    line("web", ui ? `${ui.web ? "OK" : "DOWN"} testids=${ui.testids.length} convention=${ui.convention}` : "未探测"),
    line("createForm", ui ? `${ui.createForm ? "OK" : "MISSING"} ${ui.reasons["createForm"] ?? ""}` : "-"),
    line("stage", ui ? `${ui.stage ? "OK" : "MISSING"} ${ui.reasons["stage"] ?? ""}` : "-"),
    line("replay", ui ? `${ui.replay ? "OK" : "MISSING"} ${ui.reasons["replay"] ?? ""}` : "-"),
    line("qa.sse", ui ? `${ui.qaSse ? "OK" : "MISSING"} ${ui.reasons["qaSse"] ?? ""}` : "-"),
    line("strict", env.strict ? "ON（缺失即失败）" : "OFF（缺失即 skip）"),
  ];
  return rows.join("\n");
}
