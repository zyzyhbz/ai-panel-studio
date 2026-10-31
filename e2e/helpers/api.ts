import { apiUrl } from "./env";
import type {
  ApiError,
  DiscussionDetail,
  DiscussionState,
  EventPage,
  HealthResponse,
} from "./types";

/**
 * 轻量 API client（Node fetch），不依赖 Playwright 的 request fixture。
 *
 * 为什么不用 `request` fixture：
 * - 需要精确控制超时与请求头（含 x-qa-scenario），并拿到原始 status/headers；
 * - 后续 SSE 压测脚本要在纯 Node 下复用同一套调用，保持"UI 断言"与"接口断言"同源。
 */

export interface ApiResult<T> {
  status: number;
  ok: boolean;
  body: T | ApiError | null;
  headers: Record<string, string>;
  requestId: string | null;
  durationMs: number;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class ApiClient {
  constructor(private readonly base: string = apiUrl("")) {}

  /** 是否可达（不抛错），供能力探测使用。 */
  async reachable(timeoutMs = 2500): Promise<boolean> {
    try {
      const r = await this.get("/api/health", { timeoutMs });
      return r.status === 200;
    } catch {
      return false;
    }
  }

  get<T = unknown>(path: string, opts: RequestOptions = {}) {
    return this.request<T>("GET", path, undefined, opts);
  }

  post<T = unknown>(path: string, body?: unknown, opts: RequestOptions = {}) {
    return this.request<T>("POST", path, body, opts);
  }

  async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<ApiResult<T>> {
    const timeoutMs = opts.timeoutMs ?? 20_000;
    const started = Date.now();
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...opts.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text; // 保留原文，让泄露扫描能看到非 JSON 响应
      }
    }

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });

    return {
      status: res.status,
      ok: res.ok,
      body: parsed as T | ApiError | null,
      headers,
      requestId: headers["x-request-id"] ?? null,
      durationMs: Date.now() - started,
    };
  }

  /* --------------------------- 具体接口 --------------------------- */

  health(opts: RequestOptions = {}) {
    return this.get<HealthResponse>("/api/health", opts);
  }

  listDiscussions(
    params: { status?: string; limit?: number; offset?: number } = {},
    opts: RequestOptions = {},
  ) {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.offset !== undefined) q.set("offset", String(params.offset));
    const qs = q.toString();
    return this.get<{ items: unknown[]; total: number }>(
      `/api/discussions${qs ? `?${qs}` : ""}`,
      opts,
    );
  }

  createDiscussion(
    input: { topic: string; expertCount?: number; clientRequestId?: string },
    opts: RequestOptions = {},
  ) {
    return this.post<{ discussion: DiscussionDetail["discussion"]; experts: unknown[] }>(
      "/api/discussions",
      {
        topic: input.topic,
        expertCount: input.expertCount ?? 4,
        clientRequestId: input.clientRequestId ?? crypto.randomUUID(),
      },
      opts,
    );
  }

  getDiscussion(id: string, opts: RequestOptions = {}) {
    return this.get<DiscussionDetail>(`/api/discussions/${id}`, opts);
  }

  getState(id: string, opts: RequestOptions = {}) {
    return this.get<DiscussionState>(`/api/discussions/${id}/state`, opts);
  }

  getEvents(
    id: string,
    params: { after?: number; limit?: number } = {},
    opts: RequestOptions = {},
  ) {
    const q = new URLSearchParams();
    if (params.after !== undefined) q.set("after", String(params.after));
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return this.get<EventPage>(`/api/discussions/${id}/events${qs ? `?${qs}` : ""}`, opts);
  }

  confirm(id: string, opts: RequestOptions = {}) {
    return this.post<{ discussion: DiscussionDetail["discussion"] }>(
      `/api/discussions/${id}/confirm`,
      undefined,
      opts,
    );
  }

  regenerate(id: string, opts: RequestOptions = {}) {
    return this.post<{ discussion: DiscussionDetail["discussion"] }>(
      `/api/discussions/${id}/roster/regenerate`,
      undefined,
      opts,
    );
  }

  end(id: string, opts: RequestOptions = {}) {
    return this.post<{ discussion: DiscussionDetail["discussion"] }>(
      `/api/discussions/${id}/end`,
      undefined,
      opts,
    );
  }

  /** 分页拉全量事件（按 seq 升序）。 */
  async getAllEvents(id: string, opts: RequestOptions = {}) {
    const all: EventPage["items"] = [];
    let after = 0;
    for (let page = 0; page < 20; page += 1) {
      const res = await this.getEvents(id, { after, limit: 500 }, opts);
      if (!res.ok || res.body === null || typeof res.body !== "object" || "error" in res.body) {
        return { ok: false, status: res.status, items: all, error: res.body };
      }
      const pageBody = res.body as EventPage;
      all.push(...pageBody.items);
      if (!pageBody.hasMore || pageBody.items.length === 0) break;
      after = pageBody.items[pageBody.items.length - 1]!.seq;
    }
    return { ok: true, status: 200, items: all, error: null };
  }
}

export const api = new ApiClient();
