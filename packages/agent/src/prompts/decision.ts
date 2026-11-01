import { HOST_INTENTS } from "@ai-panel/shared";
import type { DiscussionSnapshot } from "../core/types";
import {
  CONTEXT_BUDGET,
  assembleContext,
  intentLabel,
  phaseLabel,
  renderContextBlock,
  renderSaturation,
} from "../context/assemble";
import type { ContextBundle } from "../context/assemble";
import type { PromptSpec } from "../llm/types";
import type { Eligibility } from "../policy/eligibility";
import { preferredIntents } from "../policy/eligibility";
import { makeSpec, repairBlock, SHARED_RULES } from "./common";

export interface DecisionPromptInput {
  snapshot: DiscussionSnapshot;
  eligibility: Eligibility;
  /** 复用一个已组装的上下文，避免重复计算 */
  context?: ContextBundle;
  repairHint?: string;
}

/**
 * P-DECIDE v2：按"谁欠谁一个回答"选人，不按角色轮转。
 *
 * 决策优先级（写死在 prompt 里）：
 * 1. 有未回应的挑战 → 让被挑战的人回答（answer_challenge）；
 * 2. 最强张力没被戳破 → 主持人 pressure_test；
 * 3. 立场相反、且还没交锋过的人；
 * 4. 最后才轮到"还没说过话的人"补位。
 *
 * `<allowed_speakers>` 仍是机器可读块（mock 与后端解析靠它），顺序按稳定哈希打乱。
 */
export function buildDecisionPrompt(input: DecisionPromptInput): PromptSpec {
  const { snapshot, eligibility } = input;
  const context =
    input.context ??
    assembleContext(snapshot, {
      purpose: "decision",
      budgetTokens: CONTEXT_BUDGET.decision,
      mustClose: eligibility.mustClose,
    });

  const quota = eligibility.host;
  const neverSpokenNames = eligibility.neverSpoken
    .map((id) => snapshot.experts.find((e) => e.id === id)?.name ?? id)
    .join("、");

  const priorityNames = eligibility.prioritySpeakerIds
    .map((id) => snapshot.experts.find((e) => e.id === id)?.name ?? id)
    .join("、");

  // 打乱候选顺序：稳定哈希排序，既非原序也不随机（可复现）
  const shuffled = [...eligibility.allowedSpeakers].sort((a, b) =>
    shuffleKey(snapshot.discussionId, eligibility.turnIndex, a.id).localeCompare(
      shuffleKey(snapshot.discussionId, eligibility.turnIndex, b.id),
    ),
  );

  const speakerLines = shuffled
    .map((c) =>
      [
        `id=${c.id}`,
        c.name,
        c.role === "host" ? "主持" : "专家",
        `已发言${c.speakCount}次`,
        `连续${c.consecutiveCount}次`,
        `上次${c.lastIntent ? intentLabel(c.lastIntent) : "无"}`,
        polarityText(c.polarity),
        c.stanceAxis,
      ].join(" | "),
    )
    .join("\n");

  const forcedLine = eligibility.forcedSpeakerId
    ? `\n# 本轮已被指定\n本轮必须由 ${nameOf(snapshot, eligibility.forcedSpeakerId)} 发言（原因：${
        eligibility.forcedReason === "opening"
          ? "开场"
          : eligibility.forcedReason === "coverage"
            ? "还有人一次都没发言"
            : "进入收尾"
      }）。`
    : "";

  const closeLine = eligibility.canClose
    ? eligibility.mustClose
      ? "可以收尾：true（已收敛或到安全上限，这一轮应让主持人做 summary）"
      : `可以收尾：true（已过覆盖保底，但还没收敛——${eligibility.saturation.reasons.join("；") || "条件未满足"}，不建议 close）`
    : `可以收尾：false（还在覆盖保底内，第 ${eligibility.coverageFloor} 轮前不许收）`;

  const suggested = preferredIntents(eligibility.phase, "expert").map(intentLabel).join("、");

  const system = `你是「AI 圆桌」的调度器（Dispatcher）。
你不写发言内容，不解释理由，不输出思考过程。
你只回答一个问题：**这一轮，谁最该说话、以什么方式说、围绕哪个争点。**

# 硬性要求
${SHARED_RULES}
5. 只能从 <allowed_speakers> 里选 speakerId，不得编造、不得选列表外的人。
6. 只输出一个 JSON 对象，不要 markdown，不要解释。`;

  const user = `# 议题
${context.topic}

${renderContextBlock(context)}

${renderSaturation(eligibility.saturation)}

# 本场状态
第 ${eligibility.turnIndex} 轮（覆盖保底 ${eligibility.coverageFloor} 轮 / 安全上限 ${eligibility.maxTurns} 轮）
阶段：${phaseLabel(eligibility.phase)}
${closeLine}
主持配额：开场 ${quota.openingDone ? "已完成" : "待完成"}｜追问 ${quota.probeUsed}｜串联 ${quota.mediateUsed}｜收尾 ${quota.summaryDone ? "已完成" : "待完成"}（主持上限 ${quota.limit} 次，已用 ${quota.used}）
尚未发言：${neverSpokenNames || "（所有人都发过言）"}
${priorityNames ? `**欠回答的人：${priorityNames}**（${eligibility.openChallengeCount} 个挑战还没被回应）` : "欠回答的人：（没有积压的挑战）"}

# 这一轮最该做的事（按优先级从上往下判断，命中就停）
1. **有人欠一个回答** → 选那个人，让 ta 正面接住挑战（rebut / support / clarify 里选一个最贴的）。
2. **最强张力还没被戳破** → 选主持人，用 probe 追问一个条件/代价，或用 mediate 把两方摆在一起。
3. **立场相反、还没真正交过锋** → 选那个还没和对方对过话的人。
4. **没人欠账、张力也谈过** → 才让还没说过话的人补位。
5. 任何时候都不要按 id 顺序选人，也不要"轮流"。

# 可选发言者（只能从中选，不得选其他人）
<allowed_speakers>
${speakerLines}
</allowed_speakers>

# 本轮阶段建议的作用力
${suggested}（建议不是硬限制；同一作用力连续三次以上请换一种）

# 规则
1. speakerId 必须是 <allowed_speakers> 里 id= 后面的值。
2. 同一专家不连续发言超过 1 次（主持人追问同一人时才允许 2 次）。
3. rebut / support / clarify 必须给 targetMessageId，指向**别人**说过的话（clarify 可指自己）。
4. mediate 必须给 references，包含两位不同专家的 messageId。
5. probe 必须给 targetMessageId，指向被追问的那条。
6. **turnFocus 写"这一轮要争的那个点"，是一句带问号或判断的争点，不是名词标签**：
   ✅「再培训成本到底该谁承担？」「AI 到底替代任务还是替代人？」
   ❌「再培训成本」「岗位结构」
7. action=close：只有"可以收尾"且收敛度显示已收敛时才用；否则一律 next。
8. reasonCode 取值：answer_challenge / pressure_test / direct_clash / fresh_voice / fills_gap / closing。
9. 只输出 JSON。
${repairBlock(input.repairHint)}${forcedLine}

# 输出 JSON
{"speakerId":"e_2","intent":"rebut","targetMessageId":"m_3","turnFocus":"AI 到底替代任务还是替代人？","action":"next","reasonCode":"answer_challenge"}

intent 取值：${HOST_INTENTS.join(" | ")} | rebut | support | extend | clarify
（主持只能用：${HOST_INTENTS.join("、")}；专家只能用：rebut、support、extend、clarify）`;

  return makeSpec({
    id: "P-DECIDE",
    kind: "json",
    system,
    user,
    includedMessageIds: context.includedMessageIds,
    paramsOverride: input.repairHint ? { temperature: 0.1 } : undefined,
  });
}

const PHASE_HINT: Record<string, string> = {
  open: "先把议题切开，别急着下结论",
  expand: "让还没说话的人把观点摆出来",
  clash: "这一阶段要真交锋：让观点直接撞上",
  deepen: "往深一层问：条件、代价、边界",
  preclose: "准备收束，不要再开新战场",
  close: "收尾，只能选主持人",
};

function polarityText(polarity: string): string {
  const map: Record<string, string> = {
    strong_oppose: "强烈反对",
    oppose: "反对",
    neutral: "中立",
    support: "支持",
    strong_support: "强烈支持",
  };
  return map[polarity] ?? polarity;
}

function nameOf(snapshot: DiscussionSnapshot, id: string): string {
  return snapshot.experts.find((e) => e.id === id)?.name ?? id;
}

/** 稳定打乱：用讨论 id + 轮次 + 人做哈希，保证同一轮重放时顺序一致。 */
function shuffleKey(discussionId: string, turnIndex: number, id: string): string {
  const seed = `${discussionId}|${turnIndex}|${id}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export { PHASE_HINT };
