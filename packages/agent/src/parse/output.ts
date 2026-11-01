import type { z } from "zod";
import { parseJsonWithSchema } from "../parse/json";
import {
  decisionOutputSchema,
  insightOutputSchema,
  rosterOutputSchema,
  type DecisionOutput,
  type InsightOutput,
  type RosterOutput,
} from "../schema";
import { normalizeSummary, type SummaryCheck } from "../policy/summary";

/**
 * 输出解析器：给 transport 的 `parse` 回调用。
 *
 * 约定：**失败一律抛 `AgentParseError`**，由 transport（server/mock）捕获后触发
 * 一次修复重试；重试仍失败再走各自的降级。
 */

export class AgentParseError extends Error {
  readonly code: "empty_output" | "invalid_json" | "schema_mismatch" | "summary_invalid";
  /** 回灌给模型的短提示 */
  readonly repairHint: string;

  constructor(
    code: AgentParseError["code"],
    message: string,
    repairHint: string,
  ) {
    super(message);
    this.name = "AgentParseError";
    this.code = code;
    this.repairHint = repairHint;
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, raw: string, label: string): T {
  const result = parseJsonWithSchema(schema, raw, label);
  if (!result.ok) {
    throw new AgentParseError(result.code, result.error, result.repairHint);
  }
  return result.data;
}

/** P-ROSTER */
export function parseRosterOutput(raw: string): RosterOutput {
  return parseOrThrow(rosterOutputSchema, raw, "roster");
}

/** P-DECIDE */
export function parseDecisionOutput(raw: string): DecisionOutput {
  return parseOrThrow(decisionOutputSchema, raw, "decision");
}

/** P-INSIGHT */
export function parseInsightOutput(raw: string): InsightOutput {
  return parseOrThrow(insightOutputSchema, raw, "insight");
}

/**
 * P-SUMMARY：纯文本，但仍要做 JSON 泄漏与长度校验。
 * 泄漏时抛错，让 transport 选择"重试一次"或直接落模板总结。
 */
export function parseSummaryText(raw: string): SummaryCheck {
  const check = normalizeSummary(raw);
  if (check.hasJsonLeak) {
    throw new AgentParseError(
      "summary_invalid",
      "summary: 输出里出现 JSON 痕迹",
      "上一次输出里带了大括号或字段名。请只输出三段自然语言，不要任何 JSON 结构。",
    );
  }
  if (Array.from(check.content).length === 0) {
    throw new AgentParseError("empty_output", "summary: 空内容", "请输出三段自然语言总结。");
  }
  return check;
}
