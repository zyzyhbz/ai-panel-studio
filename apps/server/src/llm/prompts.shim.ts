import type { InsightType, Intent, Polarity } from "@ai-panel/shared";
import { SHA_SAFE_COLORS, EXPERT_NAME_POOL } from "./fixtures";

/**
 * TEMPORARY prompt shim.
 *
 * Contract v1.0 (§1.11 / §1.12) puts runtime prompts in `packages/agent`
 * (AI/Agent owner) and forbids prompts inside `apps/server`. AI-02 has not
 * published the builders yet, so this module is a single, clearly-marked shim
 * with the same `PromptSpec` shape. When AI-02 lands:
 *   - delete this file,
 *   - import { buildRosterPrompt, buildDecisionPrompt, ... } from "@ai-panel/agent",
 *   - adapt in `prompts.ts` only (no call site changes).
 *
 * The prompts here are intentionally minimal but structurally strict: every JSON
 * prompt states the exact schema and includes one example.
 */

export interface PromptSpecLike {
  kind: "roster" | "decision" | "speech" | "insight" | "summary";
  system: string;
  user: string;
  responseFormat: "text" | "json_object";
  temperature: number;
  maxOutputTokens: number;
}

const JSON_RULE = "只输出 JSON，不要 markdown 代码块，不要解释。";

export function buildRosterPrompt(input: {
  topic: string;
  expertCount: number;
}): PromptSpecLike {
  const palette = SHA_SAFE_COLORS.slice(0, input.expertCount).join(", ");
  return {
    kind: "roster",
    system:
      "你是一档中文 AI 圆桌节目的策划。你负责设计一位中立主持人和若干立场互补的专家。" +
      "专家必须在职业、立场、关注领域上互相区分，且至少覆盖 3 种不同立场。" +
      JSON_RULE,
    user: [
      `议题：${input.topic}`,
      `需要 1 位主持人 + ${input.expertCount} 位专家。`,
      "请输出 json，结构如下：",
      '{"host":{"name":"林致远","profession":"科技主持人","title":"资深圆桌主持",' +
        '"stance":"中立，负责追问与串联","stanceAxis":"中立主持","polarity":"neutral",' +
        '"focusArea":"节奏与追问","color":"#D9D9D9"},',
      '"experts":[{"name":"周明","profession":"软件工程师","title":"技术负责人",' +
        '"stance":"AI 会重构初级岗位而不是消灭它","stanceAxis":"岗位替代 vs 岗位重构",' +
        '"polarity":"support","focusArea":"工程实践与岗位结构","color":"#5B8DEF"}]}',
      `专家颜色必须从这组里挑且不重复：${palette}。主持人固定 #D9D9D9。`,
      "polarity 只能是 strong_oppose/oppose/neutral/support/strong_support。",
      "每人 stance 是一句人话（≤40 字），stanceAxis 是立场轴名称（≤20 字），focusArea ≤20 字。",
      `experts 数量必须正好 ${input.expertCount} 个。`,
    ].join("\n"),
    responseFormat: "json_object",
    temperature: 0.9,
    maxOutputTokens: 1_200,
  };
}

export function buildDecisionPrompt(input: {
  topic: string;
  turnIndex: number;
  remainingTurns: number;
  transcript: string;
  candidates: { id: string; name: string; role: string; stance: string; focusArea: string }[];
  lastSpeakerId: string | null;
  consecutiveSameSpeaker: number;
  insights: string;
}): PromptSpecLike {
  return {
    kind: "decision",
    system:
      "你是圆桌的调度器。根据当前 transcript 决定下一位发言者与意图。" +
      "禁止固定轮流；优先选择与上一个发言有张力的人；同一人不得连续超过 2 次。" +
      "主持人只在开场、追问、串联、收尾时发言。" +
      JSON_RULE,
    user: [
      `议题：${input.topic}`,
      `当前是第 ${input.turnIndex} 轮，还剩约 ${input.remainingTurns} 轮。`,
      `可选发言者：\n${input.candidates
        .map(
          (c) =>
            `- id=${c.id} 姓名=${c.name} 角色=${c.role} 立场=${c.stance} 关注=${c.focusArea}`,
        )
        .join("\n")}`,
      `上一次发言者 id=${input.lastSpeakerId ?? "无"}，已连续 ${input.consecutiveSameSpeaker} 次。`,
      `当前共识/分歧：\n${input.insights || "（暂无）"}`,
      `最近 transcript：\n${input.transcript || "（尚无发言）"}`,
      "请输出 json：",
      '{"speakerId":"<上面某个 id>","intent":"probe|rebut|support|extend|clarify|mediate|redirect|opening|summary",' +
        '"turnFocus":"本轮关注点，≤20 字","targetMessageId":"<可选，要回应的 messageId>","references":["<可选，多个 messageId>"]}',
    ].join("\n"),
    responseFormat: "json_object",
    temperature: 0.7,
    maxOutputTokens: 300,
  };
}

export function buildSpeechPrompt(input: {
  topic: string;
  speakerName: string;
  profession: string;
  title: string;
  stance: string;
  focusArea: string;
  intent: Intent;
  turnFocus: string;
  transcript: string;
}): PromptSpecLike {
  return {
    kind: "speech",
    system:
      "你在扮演一位圆桌嘉宾。用第一人称说话，只说 1–2 句，总长不超过 120 个中文字符。" +
      "要有具体观点或反驳，不要客套，不要复述议题，不要输出 JSON、不要 markdown。" +
      "直接输出你要说的话本身。",
    user: [
      `议题：${input.topic}`,
      `你是 ${input.speakerName}（${input.profession} / ${input.title}）。`,
      `你的立场：${input.stance}`,
      `你的关注领域：${input.focusArea}`,
      `本轮意图：${input.intent}，本轮关注点：${input.turnFocus}`,
      `最近 transcript：\n${input.transcript || "（你是第一位发言者）"}`,
      "现在说出你这一轮的话。",
    ].join("\n"),
    responseFormat: "text",
    temperature: 1.0,
    maxOutputTokens: 200,
  };
}

export function buildInsightPrompt(input: {
  topic: string;
  transcript: string;
  currentInsights: string;
}): PromptSpecLike {
  return {
    kind: "insight",
    system:
      "你从圆桌 transcript 中提炼共识、分歧、待验证问题。必须给出依据发言 id；找不到依据就不要写。" +
      "输出的是全量快照（不是增量），最多 共识 8 条 / 分歧 6 条 / 待验证 6 条。" +
      JSON_RULE,
    user: [
      `议题：${input.topic}`,
      `transcript（每行以 [messageId] 开头）：\n${input.transcript}`,
      `上一版快照（可沿用、可修改、可删除）：\n${input.currentInsights || "（空）"}`,
      "请输出 json：",
      '{"insights":[{"type":"consensus|divergence|open_question","content":"一句话结论",' +
        '"evidenceMessageIds":["m_xxx"]}]}',
      "consensus 与 divergence 必须至少有 1 条 evidenceMessageIds；没有依据的内容放进 open_question。",
    ].join("\n"),
    responseFormat: "json_object",
    temperature: 0.4,
    maxOutputTokens: 900,
  };
}

export function buildSummaryPrompt(input: {
  topic: string;
  transcript: string;
  insights: string;
}): PromptSpecLike {
  return {
    kind: "summary",
    system:
      "你是圆桌主持人，正在收尾。用自然中文说 4–6 句，覆盖：共识、主要分歧、尚未解决的问题。" +
      "不要出现 JSON 字段名、不要列表符号、不要 markdown、不要英文术语。",
    user: [
      `议题：${input.topic}`,
      `transcript：\n${input.transcript}`,
      `共识/分歧/待验证：\n${input.insights || "（暂无）"}`,
      "现在给出你的收尾总结。",
    ].join("\n"),
    responseFormat: "text",
    temperature: 0.6,
    maxOutputTokens: 600,
  };
}

export const INSIGHT_TYPES_ORDER: readonly InsightType[] = [
  "consensus",
  "divergence",
  "open_question",
];

export const POLARITY_POOL: readonly Polarity[] = [
  "strong_support",
  "support",
  "neutral",
  "oppose",
  "strong_oppose",
];

export { EXPERT_NAME_POOL };
