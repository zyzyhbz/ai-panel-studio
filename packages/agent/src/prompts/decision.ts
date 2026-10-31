import { HOST_INTENTS } from "@ai-panel/shared";
import type { DiscussionSnapshot } from "../core/types";
import { assembleContext, intentLabel, phaseLabel, renderContextBlock, CONTEXT_BUDGET } from "../context/assemble";
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
 * P-DECIDE：选下一位发言者 + 意图 + 本轮关注点。
 *
 * 关键设计：
 * - `<allowed_speakers>` 是机器可读块：模型只能从里面挑 id；mock 也靠它解析候选；
 * - 顺序刻意打乱（由调用方传入前先打乱），避免模型顺号取人 → 退化成轮流；
 * - 不要求模型解释理由，只要求一个内部 reasonCode 枚举（防止长篇 CoT）。
 */
export function buildDecisionPrompt(input: DecisionPromptInput): PromptSpec {
  const { snapshot, eligibility } = input;
  const context =
    input.context ??
    assembleContext(snapshot, { purpose: "decision", budgetTokens: CONTEXT_BUDGET.decision });

  const phaseHint = PHASE_HINT[eligibility.phase] ?? "";
  const quota = eligibility.host;
  const neverSpokenNames = eligibility.neverSpoken
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

  const suggested = preferredIntents(eligibility.phase, "expert").map(intentLabel).join("、");

  const system = `你是「AI 圆桌演播厅」的调度器（Dispatcher）。
你只决定：下一位谁发言、以什么作用力发言、这一轮关注什么。
你不写发言内容，不解释理由，不输出思考过程。

# 硬性要求
${SHARED_RULES}
5. 只能从 <allowed_speakers> 里选 speakerId，不得编造、不得选列表外的人。
6. 只输出一个 JSON 对象，不要 markdown，不要解释。`;

  const user = `# 议题
${context.topic}

# 本场规格
第 ${eligibility.turnIndex} 轮 / 计划 ${eligibility.plannedTurns} 轮 / 硬上限 ${eligibility.maxTurns} 轮
阶段：${phaseLabel(eligibility.phase)}${phaseHint ? `——${phaseHint}` : ""}
主持配额：开场 ${quota.openingDone ? "已完成" : "待完成"}｜追问 ${quota.probeUsed}/1｜串联 ${quota.mediateUsed}/1｜收尾 ${quota.summaryDone ? "已完成" : "待完成"}（主持总上限 ${quota.limit} 次，已用 ${quota.used}）
尚未发言：${neverSpokenNames || "（所有人都发过言）"}
现在必须收尾：${eligibility.mustClose ? "true（只能选主持人，且 intent 必须是 summary）" : "false"}

${renderContextBlock(context)}
${forcedLine}

# 可选发言者（只能从中选，不得选其他人）
<allowed_speakers>
${speakerLines}
</allowed_speakers>

# 本轮阶段建议的作用力
${suggested}（建议不是硬限制，但如果连续两轮都是同一种作用力，请换一种）

# 规则
1. speakerId 必须是 <allowed_speakers> 里 id= 后面的值。
2. 同一专家不连续发言超过 1 次（主持人追问同一人时才是 2 次）。
3. 有人一次都没发言、且已过第 ${Math.ceil(snapshot.expertCount / 2)} 轮时，优先选他。
4. rebut / support / clarify 必须给 targetMessageId，指向**别人**说过的话（clarify 可指自己）。
5. mediate 必须给 references，包含两位不同专家的 messageId，用来表达“串联”。
6. probe 必须给 targetMessageId，指向被追问的那条。
7. turnFocus 是本轮关注点：≤20 字，名词短语，例「岗位结构的变化速度」。
   禁止「我认为」「先分析」「因为…所以」，也不要写成「反驳某人」这种动作。
8. 不要按 id 顺序或编号顺序选人；如果发现自己在按顺序取，请跳一个。
9. 只输出 JSON。
${repairBlock(input.repairHint)}

# 输出 JSON
{"speakerId":"e_2","intent":"rebut","targetMessageId":"m_3","turnFocus":"岗位结构的变化速度","action":"next","reasonCode":"direct_clash"}

intent 取值：${HOST_INTENTS.join(" | ")} | rebut | support | extend | clarify
（主持只能用：${HOST_INTENTS.join("、")}；专家只能用：rebut、support、extend、clarify）
action 取值：next | close
reasonCode 取值：fresh_voice | direct_clash | fills_gap | follow_up | closing`;

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
  clash: "这一阶段要真交锋：让观点直接撞上，不要各说各话",
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
