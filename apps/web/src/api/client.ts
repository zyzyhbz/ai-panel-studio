import type { ApiErrorBody } from "./types";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(args: {
    code: string;
    message: string;
    status: number;
    details?: Record<string, unknown>;
    requestId?: string | null;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.code = args.code;
    this.status = args.status;
    this.details = args.details ?? {};
    this.requestId = args.requestId ?? null;
  }

  /** Extra context the UI is allowed to show (never a stack, never a Key). */
  get discussionId(): string | null {
    const value = this.details.discussionId;
    return typeof value === "string" ? value : null;
  }

  get topic(): string | null {
    const value = this.details.topic;
    return typeof value === "string" ? value : null;
  }
}

const BASE = "/api";

const FALLBACK_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: "提交的内容不符合要求，请检查后再试。",
  NOT_FOUND: "这场讨论不存在，或已经被删除。",
  INVALID_STATE: "当前状态不允许这个操作。",
  RATE_LIMITED: "操作太频繁了，稍等一分钟再试。",
  ROSTER_GENERATION_FAILED: "阵容生成失败，模型这次没有给出可用的结果。",
  LLM_TIMEOUT: "生成超时了，可以再试一次。",
  LLM_INVALID_OUTPUT: "模型的输出无法解析，可以再试一次。",
  INTERNAL: "服务出了点问题，请稍后再试。",
  NETWORK: "连接不上服务，请确认后端已经启动。",
  ABORTED: "请求已取消。",
};

export function friendlyMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "NETWORK" || error.code === "ABORTED") {
      return FALLBACK_MESSAGES[error.code];
    }
    const known = FALLBACK_MESSAGES[error.code];
    // Server messages are already user-safe per contract; prefer them, but
    // never surface a code or a stack.
    if (error.message && !/^[A-Z0-9_]+$/.test(error.message)) return error.message;
    return known ?? "操作失败了，请稍后再试。";
  }
  return "操作失败了，请稍后再试。";
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, signal, headers } = options;
  let response: Response;

  // Fastify's JSON body parser rejects a `Content-Type: application/json`
  // request with an empty body (400 VALIDATION_ERROR), and the bodyless
  // command endpoints (`confirm` / `end` / `regenerate`) do not accept a
  // missing content type either. Send `{}` explicitly for every mutation.
  const mutating = method === "POST" || method === "PUT" || method === "PATCH";
  const hasBody = body !== undefined;
  const payloadBody = hasBody ? JSON.stringify(body) : mutating ? "{}" : undefined;

  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      signal,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(hasBody || mutating ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: payloadBody,
    });
  } catch (cause) {
    const aborted =
      cause instanceof DOMException && cause.name === "AbortError";
    throw new ApiError({
      code: aborted ? "ABORTED" : "NETWORK",
      message: aborted ? FALLBACK_MESSAGES.ABORTED : FALLBACK_MESSAGES.NETWORK,
      status: 0,
    });
  }

  const requestId = response.headers.get("X-Request-Id");

  if (response.status === 204) {
    return undefined as T;
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (isErrorBody(payload)) {
      throw new ApiError({
        code: payload.error.code,
        message: payload.error.message,
        details: payload.error.details,
        requestId: payload.requestId ?? requestId,
        status: response.status,
      });
    }
    throw new ApiError({
      code: response.status >= 500 ? "INTERNAL" : "INTERNAL",
      message: FALLBACK_MESSAGES.INTERNAL,
      status: response.status,
      requestId,
    });
  }

  if (payload === null) {
    // A 200 with an unparseable body usually means the Vite proxy is not
    // reachable and the dev server served index.html instead.
    throw new ApiError({
      code: "INTERNAL",
      message: "服务返回了无法解析的内容，请确认后端已经启动。",
      status: response.status,
      requestId,
    });
  }

  return payload as T;
}
