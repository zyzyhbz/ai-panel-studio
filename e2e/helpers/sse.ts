import { apiUrl } from "./env";

/**
 * Node 侧 SSE 客户端。
 *
 * 为什么需要它：`window.__qa.sse`（06 §1.9）依赖前端实现，G2 阶段前端还没有；
 * 而"补发/去重/跳号/心跳/连接上限"这些是服务端行为，用 Node 直连更快、更稳定，
 * 也不受浏览器连接数（6 个/域名）影响。
 *
 * 前端上线 `window.__qa.sse` 后，两者并用：
 * - 服务端契约（seq 连续性、补发范围、caught_up）→ 本文件；
 * - 浏览器侧"是否真的渲染了补发内容" → 页面内缓冲。
 */

export interface SseFrame {
  /** 持久化事件的 seq；临时事件（delta / stream.ready / caught_up）为 null。 */
  id: number | null;
  event: string;
  data: unknown;
  /** 原始 data 文本，用于泄露扫描。 */
  raw: string;
  receivedAt: number;
  /** 相对连接建立的毫秒数。 */
  t: number;
}

export interface SseConnectOptions {
  /** 只推 seq > after */
  after?: number;
  /** 模拟浏览器重连：带上 Last-Event-ID */
  lastEventId?: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class SseClient {
  readonly frames: SseFrame[] = [];
  readonly heartbeats: number[] = [];
  retryMs: number | null = null;
  closed = false;
  error: string | null = null;

  private startedAt = 0;
  private controller: AbortController | null = null;
  private closeReason: string | null = null;
  private waiters: Array<() => void> = [];

  private constructor(private readonly url: string) {}

  static async connect(path: string, opts: SseConnectOptions = {}): Promise<SseClient> {
    const q = new URLSearchParams();
    if (opts.after !== undefined) q.set("after", String(opts.after));
    const url = `${apiUrl(path)}${q.size > 0 ? `?${q}` : ""}`;
    const client = new SseClient(url);
    await client.open(opts);
    return client;
  }

  private async open(opts: SseConnectOptions): Promise<void> {
    this.startedAt = Date.now();
    this.controller = new AbortController();
    const timeout = setTimeout(() => {
      this.error = `connect timeout after ${opts.timeoutMs ?? 10_000}ms`;
      this.controller?.abort();
    }, opts.timeoutMs ?? 10_000);

    const headers: Record<string, string> = {
      accept: "text/event-stream",
      "cache-control": "no-cache",
      ...opts.headers,
    };
    if (opts.lastEventId !== undefined) headers["last-event-id"] = String(opts.lastEventId);

    let response: Response;
    try {
      response = await fetch(this.url, { headers, signal: this.controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok || !response.body) {
      this.closed = true;
      this.error = `SSE 建立失败：HTTP ${response.status}`;
      const text = await response.text().catch(() => "");
      throw new Error(`${this.error} ${text.slice(0, 200)}`.trim());
    }

    void this.pump(response.body);
  }

  private async pump(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx = buffer.indexOf("\n\n");
        while (idx !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          this.consume(chunk);
          idx = buffer.indexOf("\n\n");
        }
      }
    } catch (err) {
      if (!this.closed) this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.closed = true;
      this.notify();
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  }

  private consume(chunk: string): void {
    let id: number | null = null;
    let event = "message";
    const dataLines: string[] = [];

    for (const rawLine of chunk.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (line === "" || line.startsWith(":")) {
        if (line.startsWith(":") && line.toLowerCase().includes("heartbeat")) {
          this.heartbeats.push(Date.now() - this.startedAt);
        }
        continue;
      }
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "id") {
        const n = Number(value);
        id = Number.isFinite(n) && value.trim() !== "" ? n : null;
      } else if (field === "event") {
        event = value;
      } else if (field === "data") {
        dataLines.push(value);
      } else if (field === "retry") {
        const n = Number(value);
        if (Number.isFinite(n)) this.retryMs = n;
      }
    }

    if (dataLines.length === 0 && event === "message") return;
    const raw = dataLines.join("\n");
    let data: unknown = raw;
    if (raw.length > 0) {
      try {
        data = JSON.parse(raw);
      } catch {
        /* 保留字符串 */
      }
    }

    this.frames.push({
      id,
      event,
      data,
      raw,
      receivedAt: Date.now(),
      t: Date.now() - this.startedAt,
    });
    this.notify();
  }

  private notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  /** 等待断言函数满足（对已收到的帧立即求值）。 */
  async waitFor(
    predicate: (client: SseClient) => boolean,
    opts: { timeoutMs?: number; description?: string } = {},
  ): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const started = Date.now();
    while (!predicate(this)) {
      if (this.closed) {
        throw new Error(
          `SSE 已关闭，等待失败：${opts.description ?? "predicate"}（帧数 ${this.frames.length}，error=${this.error}）`,
        );
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(
          `SSE 等待超时 ${timeoutMs}ms：${opts.description ?? "predicate"}（帧数 ${this.frames.length}）`,
        );
      }
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 100);
      });
    }
  }

  async waitForEvent(event: string, opts: { timeoutMs?: number } = {}): Promise<SseFrame> {
    await this.waitFor((c) => c.frames.some((f) => f.event === event), {
      ...opts,
      description: `event=${event}`,
    });
    return this.frames.find((f) => f.event === event)!;
  }

  async waitForSeq(seq: number, opts: { timeoutMs?: number } = {}): Promise<void> {
    await this.waitFor((c) => c.maxSeq() >= seq, { ...opts, description: `seq>=${seq}` });
  }

  async waitForClose(timeoutMs = 10_000): Promise<void> {
    const started = Date.now();
    while (!this.closed) {
      if (Date.now() - started > timeoutMs) throw new Error(`SSE 未在 ${timeoutMs}ms 内关闭`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** 已收到的持久化事件的最大 seq。 */
  maxSeq(): number {
    return this.frames.reduce((m, f) => (f.id !== null && f.id > m ? f.id : m), 0);
  }

  eventNames(): string[] {
    return this.frames.map((f) => f.event);
  }

  byType(event: string): SseFrame[] {
    return this.frames.filter((f) => f.event === event);
  }

  /** 持久化事件 id 序列（按到达顺序）。 */
  seqs(): number[] {
    return this.frames.filter((f) => f.id !== null).map((f) => f.id!);
  }

  /** 重复投递的 seq（同一 id 收到多次）。 */
  duplicateSeqs(): number[] {
    const seen = new Map<number, number>();
    for (const s of this.seqs()) seen.set(s, (seen.get(s) ?? 0) + 1);
    return [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s);
  }

  /** seq 跳号：从首个 seq 到最大 seq 之间缺失的序号。 */
  missingSeqs(): number[] {
    const seqs = [...new Set(this.seqs())].sort((a, b) => a - b);
    if (seqs.length < 2) return [];
    const missing: number[] = [];
    for (let s = seqs[0]!; s <= seqs[seqs.length - 1]!; s += 1) {
      if (!seqs.includes(s)) missing.push(s);
    }
    return missing;
  }

  /** 是否为"单调递增且无跳号"的干净序列。 */
  isClean(): boolean {
    const seqs = this.seqs();
    for (let i = 1; i < seqs.length; i += 1) {
      if (seqs[i]! <= seqs[i - 1]!) return false;
    }
    return this.missingSeqs().length === 0;
  }

  close(reason = "test-close"): void {
    if (this.closed) return;
    this.closeReason = reason;
    this.closed = true;
    this.controller?.abort();
    this.notify();
  }

  getReason(): string | null {
    return this.closeReason;
  }

  /** 导出为可归档的 JSON（证据）。 */
  toEvidence(): { url: string; frames: SseFrame[]; heartbeats: number[]; retryMs: number | null; error: string | null } {
    return { url: this.url, frames: this.frames, heartbeats: this.heartbeats, retryMs: this.retryMs, error: this.error };
  }
}
