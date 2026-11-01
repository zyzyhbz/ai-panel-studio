import type { PromptId, PromptSpec } from "../llm/types";
import { DEFAULT_LLM_PARAMS, DEFAULT_TIMEOUTS, PROMPT_ID_TO_KIND, THINKING_BY_PROMPT } from "../llm/types";
import { estimateTokens } from "../core/text";

/**
 * Prompt 版本与组装工具。
 *
 * 版本规则：
 * - MAJOR：输出 schema / 行为语义变化 → 需要 PM 批准
 * - MINOR：上下文或规则变化
 * - PATCH：措辞微调
 * 版本写进结构化日志，不写进事件 payload。
 */
export const PROMPT_VERSIONS: Record<PromptId, string> = {
  // 阵容生成文本未变，保持 1.0.0
  "P-ROSTER": "1.0.0",
  // v2：按"谁欠谁一个回答"选人、turnFocus 争点化、action=close 接入饱和判定、thinking + 45s
  "P-DECIDE": "2.0.0",
  // v2：必须回应具体 messageId、四选一关系、必须新增、禁角色独白、thinking + 90s
  "P-SPEECH": "2.0.0",
  // v2：上下文改为争论结构优先（debateMap + 收敛度）、thinking + 45s
  "P-INSIGHT": "2.0.0",
  // v2：注入「仍未解决」清单、36 轮硬收需承认没聊完、thinking + 90s
  "P-SUMMARY": "2.0.0",
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
  system: string;
  user: string;
  /** 已废弃：kind 由 id 推导，保留字段仅为兼容旧调用 */
  kind?: "json" | "text";
  includedMessageIds?: string[];
  paramsOverride?: Partial<{ temperature: number; maxOutputTokens: number }>;
  timeoutMs?: number;
}

export function makeSpec(input: MakeSpecInput): PromptSpec {
  const base = DEFAULT_LLM_PARAMS[input.id];
  const params = { ...base, ...input.paramsOverride };
  const system = input.system.trim();
  const user = input.user.trim();

  return {
    kind: PROMPT_ID_TO_KIND[input.id],
    system,
    user,
    responseFormat: params.responseFormat,
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
    id: input.id,
    version: PROMPT_VERSIONS[input.id],
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUTS[input.id],
    estimatedInputTokens: estimateTokens(system) + estimateTokens(user),
    includedMessageIds: input.includedMessageIds ?? [],
    // JSON control calls stay deterministic; speech/summary get thinking.
    thinking: THINKING_BY_PROMPT[input.id],
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
