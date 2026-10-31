import type { z } from "zod";

/**
 * LLM 原始输出 → JSON → Zod。
 * 只做本地修复（去 fence、找最外层对象），绝不"猜"缺失字段。
 */

export interface JsonParseFailure {
  ok: false;
  code: "empty_output" | "invalid_json" | "schema_mismatch";
  error: string;
  /** 回灌给模型做一次修复重试的短提示 */
  repairHint: string;
}

export interface JsonParseSuccess<T> {
  ok: true;
  data: T;
  /** 是否做过本地文本修复（去 fence / 截取对象） */
  repaired: boolean;
}

export type JsonParseResult<T> = JsonParseSuccess<T> | JsonParseFailure;

/** 从可能带 fence / 前后废话的文本里截出最外层 JSON 对象。 */
export function extractJsonObject(raw: string): { text: string; repaired: boolean } | null {
  const source = raw.trim();
  if (!source) return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(source);
  const body = fenced?.[1]?.trim() ?? source;

  const start = body.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return { text: body.slice(start, i + 1), repaired: start !== 0 || Boolean(fenced) };
      }
    }
  }
  return null;
}

export function parseJsonWithSchema<T>(
  schema: z.ZodType<T>,
  raw: string,
  label: string,
): JsonParseResult<T> {
  if (!raw || raw.trim().length === 0) {
    return {
      ok: false,
      code: "empty_output",
      error: `${label}: 模型返回空内容`,
      repairHint: `上一次输出为空。请只输出一个合法 JSON 对象，不要任何解释或 markdown。`,
    };
  }

  const extracted = extractJsonObject(raw);
  if (!extracted) {
    return {
      ok: false,
      code: "invalid_json",
      error: `${label}: 未找到 JSON 对象`,
      repairHint: `上一次输出不是 JSON。请只输出一个 JSON 对象，第一个字符必须是 {，最后一个必须是 }。`,
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(extracted.text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      code: "invalid_json",
      error: `${label}: JSON 解析失败（${message}）`,
      repairHint: `上一次输出不是合法 JSON（${message}）。请修正引号与逗号后重新只输出 JSON。`,
    };
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return {
      ok: false,
      code: "schema_mismatch",
      error: `${label}: 字段校验失败（${issues}）`,
      repairHint: `上一次输出的字段不符合要求：${issues}。请严格按给定的 JSON 结构与取值约束重新输出。`,
    };
  }

  return { ok: true, data: parsed.data, repaired: extracted.repaired };
}
