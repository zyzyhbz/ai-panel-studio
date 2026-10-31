import type { ChatMessage, LLMParams, PromptId, PromptKind, PromptSpec } from "../llm/types";
import { DEFAULT_LLM_PARAMS, DEFAULT_TIMEOUTS } from "../llm/types";
import { estimateTokens } from "../core/text";

/**
 * Prompt 版本与组装工具。
 *
 * 版本规则（AGENT-BEHAVIOR §prompt 版本管理）：
 * - MAJOR：输出 schema / 行为语义变化 → 需要 PM 批准
 * - MINOR：上下文或规则变化
 * - PATCH：措辞微调
 * 版本写进结构化日志，不写进事件 payload。
 */
export const PROMPT_VERSIONS: Record<PromptId, string> = {
  "P-ROSTER": "1.0.0",
  "P-DECIDE": "1.0.0",
  "P-SPEECH": "1.0.0",
  "P-INSIGHT": "1.0.0",
  "P-SUMMARY": "1.0.0",
};

/** 所有 prompt 共用的底线规则。 */
export const SHARED_RULES = [
  "所有输出使用简体中文。",
  "只处理当前这一场讨论，不引用其他会话、示例数据或历史对话。",
  "不编造具体数字、机构、论文、人名、法规条文；没有把握就讲判断和条件。",
  "不输出思考过程、推理步骤、自我说明；不要写“让我想想”“先分析一下”。",
  "严格遵守给定的字段、字数与格式限制。",
].join("\n");

export interface MakeSpecInput {
  id: PromptId;
  kind: PromptKind;
  system: string;
  user: string;
  includedMessageIds?: string[];
  paramsOverride?: Partial<LLMParams>;
  timeoutMs?: number;
}

export function makeSpec(input: MakeSpecInput): PromptSpec {
  const base = DEFAULT_LLM_PARAMS[input.id];
  const params: LLMParams = {
    ...base,
    ...input.paramsOverride,
    thinking: "disabled",
  };

  const messages: ChatMessage[] = [
    { role: "system", content: input.system.trim() },
    { role: "user", content: input.user.trim() },
  ];

  return {
    id: input.id,
    version: PROMPT_VERSIONS[input.id],
    kind: input.kind,
    messages,
    params,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUTS[input.id],
    estimatedInputTokens: messages.reduce((sum, m) => sum + estimateTokens(m.content), 0),
    includedMessageIds: input.includedMessageIds ?? [],
  };
}

/** 把列表渲染成「- xxx」形式，空列表给一个占位，避免 prompt 里出现空白段。 */
export function bulletList(items: string[], empty = "（无）"): string {
  if (items.length === 0) return empty;
  return items.map((item) => `- ${item}`).join("\n");
}

/** 修复重试时追加的短提示（不带完整上下文，省 token）。 */
export function repairBlock(hint?: string): string {
  if (!hint) return "";
  return `\n# 上一次输出的问题\n${hint}\n请只修正这个问题，其余保持原有要求。`;
}
