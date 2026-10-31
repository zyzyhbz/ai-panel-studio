import type { DiscussionSnapshot } from "../core/types";
import {
  CONTEXT_BUDGET,
  assembleContext,
  renderContextBlock,
} from "../context/assemble";
import type { ContextBundle } from "../context/assemble";
import type { PromptSpec } from "../llm/types";
import { INSIGHT_CAPS } from "../policy/insight";
import { makeSpec, repairBlock, SHARED_RULES } from "./common";

export interface InsightPromptInput {
  snapshot: DiscussionSnapshot;
  context?: ContextBundle;
  /** 本轮最多允许新增几条 */
  maxNew?: number;
  repairHint?: string;
}

/**
 * P-INSIGHT：从 transcript 提炼共识 / 分歧 / 待验证（全量快照）。
 *
 * 设计要点：
 * - 证据只能"抄"已有 messageId，不能造；造了会被 `normalizeInsights` 整条丢弃；
 * - 台账里带 id，模型更新已有条目时必须原样带回（前端列表才不会跳）；
 * - 全量快照，条目消失即表示认为它不再成立——但要受"新增上限"约束，防刷屏。
 */
export function buildInsightPrompt(input: InsightPromptInput): PromptSpec {
  const { snapshot } = input;
  const context =
    input.context ??
    assembleContext(snapshot, { purpose: "insight", budgetTokens: CONTEXT_BUDGET.insight });
  const maxNew = input.maxNew ?? 2;

  const existing =
    snapshot.insights.length > 0
      ? snapshot.insights
          .map(
            (i) =>
              `[${i.id}] ${typeLabel(i.type)}：${i.content}（依据：${i.evidenceMessageIds.join(", ")}；首次出现第 ${i.firstSeenTurn} 轮）`,
          )
          .join("\n")
      : "（还没有任何共识/分歧记录）";

  const transcriptIds = context.includedMessageIds.join(", ");

  const system = `你是「AI 圆桌演播厅」的记录员，负责从现场发言里提炼「共识 / 分歧 / 待验证的问题」。
你只记录**已经说出来的东西**，不做推理延展，不替嘉宾补观点。

# 硬性要求
${SHARED_RULES}
5. 证据只能来自给定的 messageId 列表，必须原样复制，不得编造、不得改写 id。
6. content 里出现的任何数字，必须能在对应证据的原话里找到。
7. 只输出 JSON，不要 markdown，不要解释。`;

  const user = `# 议题
${context.topic}

${renderContextBlock(context)}

# 可用的 messageId（证据只能从这里选）
${transcriptIds || "（暂无发言，请输出空快照）"}

# 已有的共识/分歧/待验证（全量台账，带 id）
${existing}

# 判定标准（严格按此，不要放宽）
1. **共识 consensus**：至少 2 条证据，且来自**至少 2 位不同发言者**；说的是同一个争议轴上的兼容主张。
   写成一句具体的话，不要写成“大家都认为要理性看待”这种空话。
2. **分歧 divergence**：至少 2 条证据，来自至少 2 位不同发言者；content 必须写出「分歧轴」——
   格式类似“A 认为……，B 认为……”。只写“存在不同看法”不算。
3. **待验证 open_question**：讨论中有人提出、但还没有人给出明确回答的问题；至少 1 条证据（提出问题的那句）。
4. 归不到上面三类的，直接丢弃，不要硬凑。

# 输出规则
1. 输出**全量快照**：本轮你认为仍然成立的条目都要列出来，不只是新增的。
2. 已有条目必须原样带回它的 id；content 可以改得更准，evidenceMessageIds 只增不减。
3. 新条目不要写 id（系统会分配），也不要写 firstSeenTurn（系统会填）。
4. content ≤50 字、一句话，禁止出现「我」。
5. 本轮最多新增 ${maxNew} 条，宁少勿滥。
6. 每条上限：共识 ${INSIGHT_CAPS.consensus} 条、分歧 ${INSIGHT_CAPS.divergence} 条、待验证 ${INSIGHT_CAPS.open_question} 条。
7. 如果没有可靠的结论，就输出 {"insights":[]}——空快照是合法答案，不要编。
${repairBlock(input.repairHint)}

# 输出 JSON
{"insights":[{"id":"i_ab12cd34","type":"divergence","content":"分歧在于初级岗位是被压缩还是被升级","evidenceMessageIds":["m_2","m_5"]}]}

type 取值：consensus | divergence | open_question`;

  return makeSpec({
    id: "P-INSIGHT",
    kind: "json",
    system,
    user,
    includedMessageIds: context.includedMessageIds,
    paramsOverride: input.repairHint ? { temperature: 0.1 } : undefined,
  });
}

function typeLabel(type: string): string {
  switch (type) {
    case "consensus":
      return "共识";
    case "divergence":
      return "分歧";
    default:
      return "待验证";
  }
}
