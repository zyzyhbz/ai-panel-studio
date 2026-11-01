import type { Page, Response } from "@playwright/test";

/**
 * 泄露扫描：Key / CoT / 原始 JSON / 堆栈。
 *
 * 纪律（QA-PLAN §11）：
 * - 只输出"命中位置 + 脱敏片段"，绝不回显完整 Key；
 * - 扫描范围必须显式（响应体 / SSE 帧 / DOM / 日志文件），否则"没发现"没有意义。
 */

const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "deepseek-key", re: /\bsk-[A-Za-z0-9_-]{12,}\b/ },
  { name: "env-assignment", re: /\bDEEPSEEK_API_KEY\s*[=:]\s*\S{8,}/i },
  { name: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._-]{16,}/i },
  { name: "authorization-header", re: /\bauthorization\b\s*[:=]\s*\S{8,}/i },
];

const COT_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "reasoning_content", re: /reasoning_content/i },
  { name: "chain_of_thought", re: /\bchain[_-]?of[_-]?thought\b/i },
  { name: "thinking-block", re: /\bthinking\b\s*[:=]/i },
  { name: "messages-array", re: /"messages"\s*:\s*\[/ },
  { name: "system-prompt", re: /\b(you are|你是一个|你的角色是)\b[\s\S]{0,80}?\b(system|助手|agent)\b/i },
];

const JSON_LEAK_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "raw-json-open", re: /\{\s*"/ },
  { name: "field-consensus", re: /"(consensus|divergence|open_question)"\s*:/ },
  { name: "field-evidence", re: /"evidenceMessageIds"\s*:/ },
  { name: "field-intent", re: /"intent"\s*:\s*"/ },
  { name: "field-turnIndex", re: /"turnIndex"\s*:/ },
  { name: "field-stanceAxis", re: /"stanceAxis"\s*:/ },
];

const STACK_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "node-stack", re: /^\s+at\s+\S+\s+\(.*:\d+:\d+\)/m },
  { name: "sqlite-error", re: /\bSQLITE_[A-Z_]+\b/ },
  { name: "node-modules-path", re: /node_modules[\\/]/ },
  { name: "abs-win-path", re: /\b[A-Za-z]:\\(?:[\w .-]+\\){1,}/ },
  { name: "library-frame", re: /\bat\s+(Object\.|Module\.|process\.)/ },
];

export interface Hit {
  pattern: string;
  where: string;
  /** 脱敏后的片段（首 4 位 + 长度 + 末 2 位）。 */
  sample: string;
}

export function mask(value: string): string {
  const v = value.trim();
  if (v.length <= 8) return `${v.slice(0, 2)}***(${v.length})`;
  return `${v.slice(0, 4)}***${v.slice(-2)}(${v.length})`;
}

function scan(text: string, where: string, patterns: { name: string; re: RegExp }[]): Hit[] {
  const hits: Hit[] = [];
  for (const { name, re } of patterns) {
    const m = re.exec(text);
    if (m) hits.push({ pattern: name, where, sample: mask(m[0]) });
  }
  return hits;
}

export function findSecrets(text: string, where: string): Hit[] {
  return scan(text, where, SECRET_PATTERNS);
}

export function findCot(text: string, where: string): Hit[] {
  return scan(text, where, COT_PATTERNS);
}

export function findJsonLeak(text: string, where: string): Hit[] {
  return scan(text, where, JSON_LEAK_PATTERNS);
}

export function findStack(text: string, where: string): Hit[] {
  return scan(text, where, STACK_PATTERNS);
}

export function assertClean(text: string, where: string): void {
  const hits = [...findSecrets(text, where), ...findStack(text, where)];
  if (hits.length > 0) {
    throw new Error(
      `发现疑似密钥/堆栈泄露 @ ${where}：${hits.map((h) => `${h.pattern}(${h.sample})`).join(", ")}`,
    );
  }
}

export function assertNoCot(text: string, where: string): void {
  const hits = findCot(text, where);
  if (hits.length > 0) {
    throw new Error(`发现疑似隐藏 CoT @ ${where}：${hits.map((h) => h.pattern).join(", ")}`);
  }
}

export function assertNoJsonLeak(text: string, where: string): void {
  const hits = findJsonLeak(text, where);
  if (hits.length > 0) {
    throw new Error(`发现原始 JSON 泄露 @ ${where}：${hits.map((h) => h.pattern).join(", ")}`);
  }
}

/* ------------------------------------------------------------------ */
/* 网络记录器                                                           */
/* ------------------------------------------------------------------ */

export interface CapturedResponse {
  url: string;
  status: number;
  contentType: string;
  headers: Record<string, string>;
  body: string;
}

const MAX_BODY = 512 * 1024;

/**
 * 抓取一次页面会话内的所有响应体，供泄露扫描与"接口被前端调用"断言。
 * 只抓文本类响应；二进制（图片/字体）跳过，避免无谓开销。
 */
export class NetworkRecorder {
  readonly responses: CapturedResponse[] = [];
  private readonly pending: Promise<void>[] = [];

  constructor(private readonly page: Page) {
    page.on("response", (res) => {
      const task = this.capture(res).catch(() => undefined);
      this.pending.push(task);
    });
  }

  private async capture(res: Response): Promise<void> {
    const contentType = (await res.headerValue("content-type")) ?? "";
    if (!/json|text|javascript|event-stream/i.test(contentType)) return;
    if (/image|font|woff/i.test(contentType)) return;
    let body = "";
    try {
      body = await res.text();
    } catch {
      return; // 流式/已关闭响应取不到全文，属于正常情况
    }
    if (body.length > MAX_BODY) body = body.slice(0, MAX_BODY);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(await res.allHeaders())) headers[k.toLowerCase()] = v;
    this.responses.push({ url: res.url(), status: res.status(), contentType, headers, body });
  }

  async settle(): Promise<void> {
    await Promise.allSettled(this.pending);
  }

  /**
   * 用于"密钥/CoT/JSON 泄露"扫描的文本。
   *
   * 刻意**排除 JS/TS 源与 bundle**：dev 模式下 Vite 会把 `/node_modules/.vite/...`
   * 这类模块 URL 写进模块图，被 `node_modules[\\/]` 规则命中会造成假阳性
   * （曾把"首页无堆栈泄露"误判为失败）。堆栈扫描只应作用于 JSON/HTML/文本响应。
   */
  allText(): string {
    return this.responses
      .filter((r) => !/javascript|ecmascript/i.test(r.contentType))
      .map((r) => r.body)
      .join("\n");
  }

  /** 全部响应文本（排查用，不用于断言）。 */
  allTextIncludingScripts(): string {
    return this.responses.map((r) => r.body).join("\n");
  }

  find(predicate: (r: CapturedResponse) => boolean): CapturedResponse[] {
    return this.responses.filter(predicate);
  }

  /** 是否有响应体包含给定子串（用于"前端确实调了 /state"这类断言）。 */
  hasBodyContaining(needle: string): boolean {
    return this.responses.some((r) => r.body.includes(needle));
  }
}

/** 扫描 DOM 文本（含 aria-label / title 等属性）。 */
export async function domText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.body;
    const attrs: string[] = [];
    root.querySelectorAll("*").forEach((el) => {
      for (const name of ["aria-label", "title", "alt", "placeholder"]) {
        const v = el.getAttribute(name);
        if (v) attrs.push(v);
      }
    });
    return `${root.innerText}\n${attrs.join("\n")}`;
  });
}
