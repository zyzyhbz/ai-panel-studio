import type { Intent } from "@ai-panel/shared";
import type { DiscussionSnapshot, ExpertPersona, TurnDecision } from "../core/types";
import {
  CONTEXT_BUDGET,
  assembleContext,
  intentLabel,
  messageLine,
  renderContextBlock,
  renderSaturation,
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
 * P-SPEECH v2：辩论，不是角色独白。
 *
 * 用户反馈"专家只是在演角色"，根因不是人设不够，而是 prompt 里没有"必须回应谁"的硬约束。
 * v2 的三条核心：
 * 1. 必须回应一个具体 messageId（不是"刚才有人说"）；
 * 2. 必须明确关系：反对 / 支持 / 有条件同意 / 澄清误读；
 * 3. 必须新增一个理由/反例/边界/代价，且不得重复自己上一轮的核心句。
 */
export function buildSpeechPrompt(input: SpeechPromptInput): PromptSpec {
  const { snapshot, decision, speaker } = input;
  const isHost = speaker.role === "host";
  const context =
    input.context ??
    assembleContext(snapshot, {
      purpose: "speech",
      budgetTokens: CONTEXT_BUDGET.speech,
      mustClose: decision.intent === "summary",
    });

  const target = decision.targetMessageId
    ? snapshot.messages.find((m) => m.id === decision.targetMessageId)
    : undefined;
  const references = (decision.references ?? [])
    .map((id) => snapshot.messages.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));

  const ownLast = [...snapshot.messages].reverse().find((m) => m.expertId === speaker.id);

  const system = isHost
    ? `你是这场圆桌的主持人 ${speaker.name}。你不是报幕员，你的任务是让争论更深，不是让流程更顺。
你只做三件事：指认当前最强的张力或被回避的前提；追问一个条件、代价或反例；在收敛时收束。
你不站队，不替专家下结论，也不按顺序点名。

# 硬性要求
${SHARED_RULES}
5. 禁止「下面请 X 发言」「有请下一位」「我们听听 X 怎么看」这类串场。
6. 不介绍自己，不加「姓名：」前缀，不用括号动作，不用 markdown。
7. 直接输出你要说的话，不要任何前缀或解释。`
    : `你是 ${speaker.name}，${speaker.profession}，${speaker.title}。
你在一场真实发生的圆桌争论里。你不是在表演这个角色，你是在跟具体的人争论。
你的目标不是守住人设，而是把对方的说法逼到更具体，或者在证据面前修正自己。

你过去的判断：${speaker.stance}
（这是你上一轮的判断，**不是教条**：如果对方的证据更强，就明确修正或让步。）

# 这场辩论的规则（违反任何一条，这句话就作废）
1. 每一轮必须回应一个具体的人的某句话（会给 messageId 和原话），不能泛泛谈观点。
2. 必须明确你和那句话的关系：反对 / 支持 / 有条件同意 / 澄清误读，四选一，并说清是对哪半句。
3. 必须新增至少一个：新理由、新反例、新边界、新代价。只重复立场等于没说。
4. 不得以「作为……」「我的立场是……」「我一贯认为……」开头，不自我介绍、不介绍身份。
5. 不得重复你上一轮的核心句（会给出来）。
6. 被说服时明确让步或修正条件，比硬撑更可信。
7. 1–2 句，≤120 字；口语，不写小标题、不列点。

# 硬性要求
${SHARED_RULES}`;

  const lengthRule = isHost
    ? "1–2 句，总共不超过 60 字（主持人比专家更短，别抢戏）。"
    : "1–2 句，总共不超过 120 字；简短是硬要求，不要写成小作文。";

  const targetBlock = target
    ? `# 你在回应谁（必须回应这一条）
[${target.id}] ${target.speakerName}（${intentLabel(target.intent)}）：「${truncateChars(target.content, 60)}」

先在心里回答：你到底是反对它的哪半句？还是支持但要加条件？还是要澄清它误读了你的意思？`
    : `# 你在回应谁
这一轮没有指定回应对象——你必须自己从上面的「未回应的挑战」里挑一条，并在句子里点明对方说了什么。`;

  const referenceBlock =
    references.length > 0
      ? `\n# 这一轮还涉及\n${references.map((m) => messageLine(m)).join("\n")}`
      : "";

  const ownBlock = ownLast
    ? `\n# 你上一轮说过（不要重复核心句）\n[${ownLast.id}] ${truncateChars(ownLast.content, 50)}`
    : "";

  const hostTaskBlock = isHost ? `\n# 这一轮你要做的事\n${hostTask(decision.intent, context)}` : "";

  const user = `# 议题
${context.topic}

${renderContextBlock(context)}
${hostTaskBlock}

# 这一轮
第 ${context.plan.turnIndex} 轮（覆盖保底 ${context.plan.plannedTurns} / 安全上限 ${context.plan.maxTurns}）
你的作用：${intentLabel(decision.intent)}
本轮争点：${decision.turnFocus}
${targetBlock}${referenceBlock}${ownBlock}

# 你必须做到
1. ${lengthRule}
2. ${isHost ? hostRule(decision.intent) : "第一句就要落到上面那条具体说法上（可短引 ≤15 字，别整段复读）。"}
3. ${isHost ? "追问必须具体到「条件 / 代价 / 反例 / 边界」里的一个，不要问“你怎么看”。" : "必须明确四选一：反对 / 支持（并加码）/ 有条件同意（说出条件）/ 澄清误读（说清你真正的意思）。"}
4. ${isHost ? "不要按名单顺序点名；只点这一轮真正相关的人。" : `至少新增一个：${noveltyHint(snapshot, speaker.id)}`}
5. ${isHost ? "不站队、不替专家下结论。" : "不重复自己上一轮的核心句，也不复述别人说过的话。"}
6. 不编造具体数据、机构、论文、人名；没有把握就讲判断和条件。
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

/**
 * 新增内容的确定性提示：看这位专家过去用过什么论证手法，
 * 让他这次换一种（避免每轮都是"我认为"）。
 */
export function noveltyHint(snapshot: DiscussionSnapshot, speakerId: string): string {
  const own = snapshot.messages.filter((m) => m.expertId === speakerId);
  if (own.length === 0) return "一个新理由（为什么你会这么判断）";
  const joined = own.map((m) => m.content).join(" ");
  if (/例如|比如|举个例子|案例|数据显示|统计/.test(joined)) {
    return "一个新边界（在什么条件下你会改口）";
  }
  if (/如果|除非|前提|取决于|条件/.test(joined)) {
    return "一个新反例（有没有反着成立的例子）";
  }
  if (/代价|成本|买单|损失/.test(joined)) {
    return "一个新理由（换一个角度支撑你的判断）";
  }
  return "一个新代价（这件事最后谁买单）";
}

function hostRule(intent: Intent): string {
  switch (intent) {
    case "opening":
      return "切开一个可争论的命题（不是复述议题），点 2–3 个人名，不念头衔。";
    case "probe":
      return "先短引对方一句（≤15 字），再追问一个具体条件或代价；不要泛泛问“你怎么看”。";
    case "mediate":
      return "先指认「你们其实在争 X」，再把话抛给其中一位或第三方；不要站队。";
    case "redirect":
      return "指出「还没人谈 X」，点一位没发言的人接手。";
    case "summary":
      return "只讲争出了什么、还差什么，并点出 1–2 个还没解决的争点；不逐人复述。";
    default:
      return "推进这场争论。";
  }
}

function hostTask(intent: Intent, context: ContextBundle): string {
  const parts: string[] = [];
  if (context.debateMap.openChallenges.length > 0) {
    const first = context.debateMap.openChallenges[0]!;
    parts.push(
      `- 现在最该被戳破的是 [${first.messageId}]：${first.fromName}问${first.toName}的那句还没被回答。`,
    );
  }
  if (context.debateMap.avoidedPremises.length > 0) {
    parts.push(`- 有一个前提一直没人验证：${context.debateMap.avoidedPremises[0]}`);
  }
  if (context.debateMap.tensions.length > 0) {
    parts.push(`- 当前最强张力：${context.debateMap.tensions[0]}`);
  }
  parts.push(
    `- 收敛度：${
      context.debateMap.saturation.ready
        ? "已收敛，可以收尾"
        : `未收敛（${context.debateMap.saturation.reasons.join("；")}）`
    }`,
  );
  return `${renderSaturation(context.debateMap.saturation)}\n${parts.join("\n")}`;
}
