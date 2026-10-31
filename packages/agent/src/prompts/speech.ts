import type { Intent } from "@ai-panel/shared";
import type { DiscussionSnapshot, ExpertPersona, TurnDecision } from "../core/types";
import {
  CONTEXT_BUDGET,
  assembleContext,
  intentLabel,
  messageLine,
  renderContextBlock,
} from "../context/assemble";
import type { ContextBundle } from "../context/assemble";
import type { PromptSpec } from "../llm/types";
import { truncateChars } from "../core/text";
import { makeSpec, repairBlock, SHARED_RULES } from "./common";

export interface SpeechPromptInput {
  snapshot: DiscussionSnapshot;
  decision: TurnDecision;
  /** 发言人（主持人或专家） */
  speaker: ExpertPersona;
  context?: ContextBundle;
  repairHint?: string;
}

/**
 * P-SPEECH：一位角色的一次发言。
 *
 * 输出是**纯文本**，不是 JSON：
 * - 流式首字不能是 `{"content":"`，否则前端必须先剥壳才敢显示，断流时还会留下半截 JSON；
 * - 长度与句数由 `validateSpeech` 后置兜底（只截断，不扩写）。
 */
export function buildSpeechPrompt(input: SpeechPromptInput): PromptSpec {
  const { snapshot, decision, speaker } = input;
  const isHost = speaker.role === "host";
  const context =
    input.context ??
    assembleContext(snapshot, {
      purpose: "speech",
      budgetTokens: CONTEXT_BUDGET.speech,
    });

  const target = decision.targetMessageId
    ? snapshot.messages.find((m) => m.id === decision.targetMessageId)
    : undefined;
  const references = (decision.references ?? [])
    .map((id) => snapshot.messages.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));

  const targetBlock = target
    ? `\n# 你要回应的那句\n${messageLine(target)}\n（回应时引用对方原话不要超过 15 字，别整段复读）`
    : "";
  const referenceBlock =
    references.length > 0
      ? `\n# 这一轮还涉及\n${references.map((m) => messageLine(m)).join("\n")}`
      : "";

  const system = isHost
    ? `你是这场圆桌的主持人 ${speaker.name}，${speaker.profession}，${speaker.title}。
你中立，不站队，不替专家下结论。你的价值在于：把话问具体、把分歧点出来、把节奏控住。
你说话很短，通常一句话就够。

# 硬性要求
${SHARED_RULES}
5. 不输出思考过程，不复述议题原文，不做自我介绍。
6. 直接输出你要说的话，不要任何前缀、引号或解释。`
    : `你是这场圆桌的嘉宾 ${speaker.name}，${speaker.profession}，${speaker.title}。
你的立场：${speaker.stance}
你的关注点：${speaker.focusArea}（争议轴：${speaker.stanceAxis}；位置：${polarityText(speaker.polarity)}）
你不是助手，你就是这位嘉宾。你在一个圆桌现场，别人能听见你，你也能听见别人。

# 硬性要求
${SHARED_RULES}
5. 不自我介绍，不说“作为一个……”，不加“姓名：”前缀，不用括号动作，不用 markdown 或 emoji。
6. 直接输出你要说的话，不要任何前缀、引号或解释。`;

  const lengthRule = isHost
    ? "1–2 句，总共不超过 60 字（主持人比专家更短，别抢戏）。"
    : "1–2 句，总共不超过 120 字；简短是硬要求，不要写成小作文。";

  const user = `# 议题
${context.topic}

# 这一轮
第 ${snapshot.turnCount + 1} 轮 / 计划 ${snapshot.plannedTurns} 轮
你的作用：${intentLabel(decision.intent)}（${intentHint(decision.intent)}）
你这一轮关注：${decision.turnFocus}
${targetBlock}${referenceBlock}

${renderContextBlock(context)}

# 你必须做到
1. ${lengthRule}
2. 必须带来现场还没有的东西：新理由 / 新反例 / 明确让步 / 明确边界，四选一。
3. ${intentRule(decision.intent, isHost)}
4. 不复述别人说过的话，不说「正如刚才所说」「我同意前面」这种空转句。
5. 不编造具体数据、机构、论文、人名；没有把握就讲判断和条件。
6. 用口语，可以有态度；不要分点、不要小标题。
${repairBlock(input.repairHint)}

# 输出
直接输出你要说的这段话。`;

  return makeSpec({
    id: "P-SPEECH",
    kind: "text",
    system,
    user,
    includedMessageIds: context.includedMessageIds,
  });
}

function intentHint(intent: Intent): string {
  switch (intent) {
    case "opening":
      return "一句话点题，给一个可争论的切口";
    case "probe":
      return "追问具体化，要求举证或说清边界";
    case "mediate":
      return "串联两位专家，点出他们真正在争什么";
    case "redirect":
      return "把话题转向没人谈过的维度";
    case "summary":
      return "收束，只讲争出了什么、还差什么";
    case "rebut":
      return "反对某个具体说法，并给出理由或反例";
    case "support":
      return "支持某个说法，并补一条新理由";
    case "clarify":
      return "澄清自己被误读的地方，给出真实边界";
    case "extend":
      return "补充一个新维度或新条件";
    default:
      return "推进讨论";
  }
}

function intentRule(intent: Intent, isHost: boolean): string {
  if (isHost) {
    switch (intent) {
      case "opening":
        return "开场：一句话说清这场要吵的是什么，再给一个具体切口，点名 2–3 位专家（不要念头衔）。";
      case "probe":
        return "追问：先短引对方一句（≤15 字），再给一个具体角度（举证 / 边界 / 反例 / 代价），不要问“你怎么看”。";
      case "mediate":
        return "串联：点名两位专家，各用 ≤15 字复述他们的说法，指出冲突点或共同前提，然后把话抛给其中一位或第三方。不要站队。";
      case "redirect":
        return "转向：指出“还没人谈 X”，并点名一位没发言的人接手。";
      case "summary":
        return "收尾：只讲这场争出了什么、还差什么；不要逐个人复述，不要下“所以结论是”。";
      default:
        return "推进。";
    }
  }
  switch (intent) {
    case "rebut":
      return "反驳：第一句必须准确指向对方某个具体说法（可短引，≤15 字），第二句给出你的理由或反例。不要泛泛说“我不同意”。";
    case "support":
      return "支持：明确同意哪一点，然后**加码**（新理由、新例子、新条件）；只附和等于没说。";
    case "clarify":
      return "澄清：先说清“我不是这个意思”或“我说的是 A，不是 B”，再补一句你真正的边界条件；不要借机长篇立论。";
    case "extend":
      return "补充：引入现场还没出现的维度、条件或反例，不要重复别人的论证。";
    default:
      return "推进讨论。";
  }
}

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

/** 供 backend 做"发言被截断/被拒绝"时给前端的可读说明（不含 CoT）。 */
export function speechPreview(text: string, max = 24): string {
  return truncateChars(text, max);
}
