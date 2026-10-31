export const API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "INVALID_STATE",
  "RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "ROSTER_GENERATION_FAILED",
  "LLM_TIMEOUT",
  "LLM_INVALID_OUTPUT",
  "LLM_NOT_CONFIGURED",
  "SSE_LIMIT_REACHED",
  "INTERNAL",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const ERROR_HTTP_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  ROSTER_GENERATION_FAILED: 502,
  LLM_TIMEOUT: 504,
  LLM_INVALID_OUTPUT: 502,
  LLM_NOT_CONFIGURED: 503,
  SSE_LIMIT_REACHED: 429,
  INTERNAL: 500,
};

/** Codes the client may retry as-is (shows a "retry" affordance). */
export const RETRYABLE_CODES: ReadonlySet<ApiErrorCode> = new Set([
  "RATE_LIMITED",
  "SSE_LIMIT_REACHED",
  "ROSTER_GENERATION_FAILED",
  "LLM_TIMEOUT",
  "LLM_INVALID_OUTPUT",
  "LLM_NOT_CONFIGURED",
  "INTERNAL",
]);

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ApiErrorCode,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = "AppError";
    this.code = code;
    if (details) this.details = details;
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }

  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details: Record<string, unknown>;
    requestId: string;
  };
}

/**
 * User-facing Chinese messages. Never includes stack traces, SQL, paths or keys.
 */
const MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: "请求参数不合法",
  NOT_FOUND: "讨论不存在",
  INVALID_STATE: "讨论当前状态不允许该操作",
  RATE_LIMITED: "请求过于频繁，请稍后再试",
  PAYLOAD_TOO_LARGE: "请求体超过 16KB 限制",
  UNSUPPORTED_MEDIA_TYPE: "不支持的请求内容类型",
  ROSTER_GENERATION_FAILED: "阵容生成失败，请重试",
  LLM_TIMEOUT: "模型响应超时，请重试",
  LLM_INVALID_OUTPUT: "模型输出异常，已自动重试",
  LLM_NOT_CONFIGURED: "服务端未配置模型，请联系管理员或启用 mock 模式",
  SSE_LIMIT_REACHED: "该讨论的实时连接数已达上限，请关闭其他页面后重试",
  INTERNAL: "服务内部错误",
};

export function toErrorBody(
  error: AppError,
  requestId: string,
  overrideMessage?: string,
): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: overrideMessage ?? error.message ?? MESSAGES[error.code],
      details: error.details ?? {},
      requestId,
    },
  };
}

export function defaultMessage(code: ApiErrorCode): string {
  return MESSAGES[code];
}
