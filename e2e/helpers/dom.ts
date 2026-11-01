import type { Page } from "@playwright/test";
import { SEL } from "./selectors";

/**
 * DOM 规范化：把界面"读成结构化状态"，用于
 * - 回放 vs 直播一致性（QA-PLAN §9.4）
 * - 多会话不串线（messageId 集合互斥）
 * - 顺序/去重/长度等硬断言
 *
 * 原则：只依赖 testid/data 属性与文本内容，**不依赖样式与文案修辞**，
 * 这样视觉改版不会误报，而状态错误一定会被抓到。
 */

/** 从 data 属性取值；取不到时按前缀从 testid 回退（兼容 FE 的内插式约定）。 */
const resolveIdSource = `
  function resolveId(el, attr, prefixes) {
    const direct = el.getAttribute(attr);
    if (direct) return direct;
    const tid = el.getAttribute('data-testid') || '';
    for (const p of prefixes) {
      if (tid.startsWith(p) && tid.length > p.length) return tid.slice(p.length);
    }
    return null;
  }
`;

export interface TranscriptEntry {
  id: string | null;
  seq: number | null;
  speakerId: string | null;
  intent: string | null;
  turnIndex: number | null;
  text: string;
  /** 发言者色块的实际颜色（rgb 或 hex），用于"色块与专家一致"断言。 */
  accent: string | null;
}

export async function normalizeTranscript(page: Page): Promise<TranscriptEntry[]> {
  const entries = await page.$$eval(
    SEL.transcriptItem,
    (els, src) => {
      const fn = new Function("return (" + src + ");")();
      return els.map((el) => {
        const node = el as HTMLElement;
        const seqRaw = node.getAttribute("data-seq");
        const turnRaw = node.getAttribute("data-turn-index");
        const swatch =
          node.querySelector<HTMLElement>("[data-speaker-color], .speaker-dot, [class*='dot']") ??
          null;
        const style = swatch ? getComputedStyle(swatch) : null;
        return {
          id: fn(node, "data-message-id", ["message-"]),
          seq: seqRaw === null ? null : Number(seqRaw),
          speakerId: fn(node, "data-speaker-id", ["message-"]),
          intent: node.getAttribute("data-intent"),
          turnIndex: turnRaw === null ? null : Number(turnRaw),
          text: (node.textContent ?? "").replace(/\\s+/g, " ").trim(),
          accent: style ? style.backgroundColor || style.borderTopColor : null,
        };
      });
    },
    resolveIdSource,
  );

  return entries.sort((a, b) => {
    const ta = a.turnIndex ?? a.seq ?? 0;
    const tb = b.turnIndex ?? b.seq ?? 0;
    return ta - tb;
  });
}

export interface ExpertEntry {
  id: string | null;
  role: string | null;
  status: string | null;
  name: string | null;
  focusArea: string | null;
  color: string | null;
}

export async function normalizeExperts(page: Page): Promise<ExpertEntry[]> {
  return page.$$eval(
    SEL.expertCard,
    (els, src) => {
      const fn = new Function("return (" + src + ");")();
      return els.map((el) => {
        const node = el as HTMLElement;
        const colorAttr = node.getAttribute("data-color");
        const swatch = node.querySelector<HTMLElement>("[data-color], [class*='swatch'], [class*='avatar']");
        return {
          id: fn(node, "data-expert-id", ["expert-card-"]),
          role: node.getAttribute("data-role"),
          status: node.getAttribute("data-status"),
          name:
            node.querySelector("[data-expert-name]")?.textContent?.trim() ??
            node.getAttribute("data-expert-name") ??
            null,
          focusArea:
            node.querySelector("[data-focus-area]")?.textContent?.trim() ??
            node.getAttribute("data-focus-area") ??
            null,
          color: colorAttr ?? (swatch ? getComputedStyle(swatch).backgroundColor : null),
        };
      });
    },
    resolveIdSource,
  );
}

export interface InsightEntry {
  id: string | null;
  type: string | null;
  evidenceCount: number | null;
  text: string;
}

export async function normalizeInsights(page: Page): Promise<{
  consensus: InsightEntry[];
  divergence: InsightEntry[];
  open_question: InsightEntry[];
}> {
  const all = await page.$$eval(
    SEL.insightItem,
    (els, src) => {
      const fn = new Function("return (" + src + ");")();
      const types = ["consensus", "divergence", "open_question"];
      return els.map((el) => {
        const node = el as HTMLElement;
        const tid = node.getAttribute("data-testid") ?? "";
        const typeAttr = node.getAttribute("data-type");
        const type =
          typeAttr ??
          types.find((t) => tid.startsWith(`insight-${t}-`)) ??
          node.closest("[data-type]")?.getAttribute("data-type") ??
          null;
        const evidenceRaw = node.getAttribute("data-evidence-count");
        return {
          id: fn(node, "data-insight-id", ["insight-consensus-", "insight-divergence-", "insight-open_question-"]),
          type,
          evidenceCount: evidenceRaw === null ? null : Number(evidenceRaw),
          text: (node.textContent ?? "").replace(/\\s+/g, " ").trim(),
        };
      });
    },
    resolveIdSource,
  );

  return {
    consensus: all.filter((i) => i.type === "consensus"),
    divergence: all.filter((i) => i.type === "divergence"),
    open_question: all.filter((i) => i.type === "open_question"),
  };
}

export interface LiveState {
  status: string | null;
  turnCount: number | null;
  connState: string | null;
  transcript: TranscriptEntry[];
  experts: ExpertEntry[];
  insights: { consensus: InsightEntry[]; divergence: InsightEntry[]; open_question: InsightEntry[] };
  summary: string | null;
}

/** 规范化"当前界面状态"，回放一致性直接对两个 LiveState 做 deepEqual。 */
export async function normalizeLiveState(page: Page): Promise<LiveState> {
  const [status, turnCount, connState, transcript, experts, insights, summary] = await Promise.all([
    attr(page, SEL.stageStatus, "data-status"),
    attr(page, SEL.stageTurnCount, "data-turn-count").then((v) => (v === null ? null : Number(v))),
    attr(page, SEL.stageConnState, "data-conn-state"),
    normalizeTranscript(page),
    normalizeExperts(page),
    normalizeInsights(page),
    textOf(page, SEL.summaryContent),
  ]);
  return { status, turnCount, connState, transcript, experts, insights, summary };
}

/** 只取"可比较部分"：去掉时间与瞬时状态，用于回放 vs 直播一致性。 */
export function comparableState(state: LiveState) {
  return {
    status: state.status,
    turnCount: state.turnCount,
    transcript: state.transcript.map((m) => ({
      id: m.id,
      seq: m.seq,
      speakerId: m.speakerId,
      intent: m.intent,
      turnIndex: m.turnIndex,
      text: m.text,
    })),
    insights: {
      consensus: state.insights.consensus.map((i) => ({ id: i.id, text: i.text })),
      divergence: state.insights.divergence.map((i) => ({ id: i.id, text: i.text })),
      open_question: state.insights.open_question.map((i) => ({ id: i.id, text: i.text })),
    },
    summary: state.summary,
  };
}

async function attr(page: Page, selector: string, name: string): Promise<string | null> {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) return null;
  return locator.getAttribute(name);
}

async function textOf(page: Page, selector: string): Promise<string | null> {
  const locator = page.locator(selector).first();
  if ((await locator.count()) === 0) return null;
  const t = await locator.textContent();
  return t === null ? null : t.replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ */
/* 布局断言                                                             */
/* ------------------------------------------------------------------ */

export interface PageOverflow {
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
  overflowY: number;
  overflowX: number;
}

/** 页面整体滚动量。>1 视为违反"页面不整体滚动"（PRD NFR-05）。 */
export async function pageOverflow(page: Page): Promise<PageOverflow> {
  return page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowY: el.scrollHeight - el.clientHeight,
      overflowX: el.scrollWidth - el.clientWidth,
    };
  });
}

export interface PanelScroll {
  panel: string;
  overflowY: string;
  scrollHeight: number;
  clientHeight: number;
  scrollable: boolean;
}

export async function panelScroll(page: Page): Promise<PanelScroll[]> {
  return page.$$eval(SEL.panel, (els) =>
    els.map((el) => {
      const node = el as HTMLElement;
      const cs = getComputedStyle(node);
      return {
        panel: node.getAttribute("data-panel") ?? node.getAttribute("data-testid") ?? "unknown",
        overflowY: cs.overflowY,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        scrollable: node.scrollHeight > node.clientHeight,
      };
    }),
  );
}

/* ------------------------------------------------------------------ */
/* 诊断                                                                 */
/* ------------------------------------------------------------------ */

export interface Diagnostics {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: { url: string; status: number }[];
  requests: string[];
  reset(): void;
}

/** 挂上 console/pageerror/requestfailed 收集器，用于"无静默错误"断言。 */
export function attachDiagnostics(page: Page): Diagnostics {
  const diag: Diagnostics = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    requests: [],
    reset() {
      diag.consoleErrors.length = 0;
      diag.pageErrors.length = 0;
      diag.failedRequests.length = 0;
      diag.requests.length = 0;
    },
  };
  page.on("console", (msg) => {
    if (msg.type() === "error") diag.consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => diag.pageErrors.push(err.message));
  page.on("requestfailed", (req) => {
    const failure = req.failure();
    diag.failedRequests.push({ url: req.url(), status: 0 });
    if (failure && !/net::ERR_ABORTED/.test(failure.errorText)) {
      diag.consoleErrors.push(`requestfailed ${req.url()} ${failure.errorText}`);
    }
  });
  page.on("response", (res) => {
    diag.requests.push(res.url());
    if (res.status() >= 400) diag.failedRequests.push({ url: res.url(), status: res.status() });
  });
  return diag;
}
