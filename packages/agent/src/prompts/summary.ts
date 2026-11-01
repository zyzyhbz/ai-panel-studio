import type { DiscussionSnapshot } from "../core/types";
import { CONTEXT_BUDGET, assembleContext, renderContextBlock } from "../context/assemble";
import { buildDebateMap } from "../context/debate-map";
import type { ContextBundle } from "../context/assemble";
import type { PromptSpec } from "../llm/types";
import { insightsForSummary } from "../policy/insight";
import { makeSpec, repairBlock, SHARED_RULES } from "./common";

export interface SummaryPromptInput {
  snapshot: DiscussionSnapshot;
  context?: ContextBundle;
  /** 主持人的收尾发言，避免总结与它重复 */
  closingLine?: string;
  repairHint?: string;
}

/**
 * P-SUMMARY：收尾后的自然语言总结。
 *
 * 纯文本三段（共识 / 分歧 / 未决），不是 JSON。
 * 理由：JSON 结构会被迫写成"字段化总结"，而 FR-10 明确要求自然语言，
 * 且任何 JSON 残留都会被前端/QA 当作泄漏。
 */
export function buildSummaryPrompt(input: SummaryPromptInput): PromptSpec {
  const { snapshot } = input;
  const context =
    input.context ??
    assembleContext(snapshot, { purpose: "summary", budgetTokens: CONTEXT_BUDGET.summary });
  const insights = insightsForSummary(snapshot.insights);
  const debate = buildDebateMap(snapshot);
  const unresolved = debate.saturation.acceptedUnresolved;
  const hardCap = snapshot.turnCount >= (snapshot.maxTurns || 36);

  const system = `你是这场圆桌的主持人，讨论已经结束，你要给观众一段总结。
你的总结要让人**不读全文也能拿走结论**，但绝不能编造讨论里没有的东西。

# 硬性要求
${SHARED_RULES}
5. 只写自然语言段落，不写 JSON、不写字段名、不用列表符号、不用小标题。
6. 不要在总结里出现新的主张或新的数据。`;

  const user = `# 议题
${context.topic}

# 讨论规模
共 ${snapshot.turnCount} 条发言，${snapshot.experts.length} 位参与者。

${renderContextBlock(context)}

# 已经确认的共识 / 分歧 / 待验证（总结只能以此为准）
${insights}
${
  unresolved.length > 0
    ? `\n# 仍未解决（第 3 段必须点到其中 1–2 条，不要含糊带过）\n${unresolved
        .map((item) => `- ${item}`)
        .join("\n")}`
    : ""
}
${hardCap ? "\n# 注意\n讨论跑到了安全上限才收，说明还有没聊完的线头——第 3 段要明确说出“哪些问题没被解决”。" : ""}
${input.closingLine ? `\n# 你刚才的收尾发言（不要整句重复）\n${input.closingLine}` : ""}

# 写作要求
1. 写成 **3 段**，段与段之间空一行：
   - 第 1 段：这场在哪些点上形成了共识（如果没有，就直接说“这场没有形成明确共识”）；
   - 第 2 段：主要分歧是什么，双方各是什么主张（要写出争的是什么，不要写“存在不同看法”）；
   - 第 3 段：还有什么没解决（有「仍未解决」清单时至少点 1–2 条），以及看这场讨论的人可以带走的一个判断。
2. 总长 180–320 字；每段 1–3 句。
3. 语气像主持人在收尾，可以有一句态度，但不要煽情。
4. 不逐个人复述观点，不写“某某说……某某又说……”。
5. 不出现 JSON 字段名、不出现大括号、不出现编号列表。
6. 如果某类内容为空，就明确说明为空，不要用模糊表述盖过去。
${repairBlock(input.repairHint)}

# 输出
直接输出三段总结正文。`;

  return makeSpec({
    id: "P-SUMMARY",
    kind: "text",
    system,
    user,
    includedMessageIds: context.includedMessageIds,
  });
}
