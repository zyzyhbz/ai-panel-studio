import type { Intent } from "@ai-panel/shared";
import type {
  DiscussionSnapshot,
  ExpertPersona,
  InsightItem,
  TranscriptMessage,
  TurnPhase,
} from "../core/types";
import { estimateTokens, truncateChars } from "../core/text";
import { coverageFloorFor, MAX_TURNS } from "../core/rounds";
import { buildDebateMap, renderDebateMap, renderSaturation, type DebateMap } from "./debate-map";
export { renderSaturation } from "./debate-map";

/**
 * 上下文组装（AR-05）。
 *
 * 设计要点：
 * - 最近 N 条全文 + 更早若干条一行式 + 结构化 insights + persona + 轮次计划；
 * - 目标是"受控预算"，不是"塞得越多越好"：预算按 tokens 硬约束，超了从最旧的开始降级；
 * - 绝不在这里做递归摘要（那是额外一次 LLM 调用，且误差会累积）。
 */

export type ContextPurpose = "decision" | "speech" | "insight" | "summary";

export const CONTEXT_BUDGET: Record<ContextPurpose, number> = {
  decision: 2600,
  speech: 3000,
  insight: 2400,
  summary: 3500,
};

/** 最近多少条保留全文 / 再往前多少条保留一行式。 */
export const FULL_WINDOW = 8;
export const DIGEST_WINDOW = 8;

export interface TurnPlan {
  turnIndex: number;
  plannedTurns: number;
  maxTurns: number;
  phase: TurnPhase;
  mustClose: boolean;
}

export interface ContextBundle {
  purpose: ContextPurpose;
  topic: string;
  plan: TurnPlan;
  /** 争论结构（确定性投影）：未回应挑战 / 当前主张 / 张力 / 被回避前提 */
  debateMap: DebateMap;
  /** 渲染好的争论结构段落（prompt 的第一段） */
  debateText: string;
  /** 渲染好的参会者段落（每行一人） */
  personas: string;
  /** 渲染好的现场段落（新→旧） */
  transcript: string;
  /** 更早发言的一行式摘要（新→旧） */
  olderDigest: string;
  /** 当前共识/分歧/待验证（全量，未裁剪顺序） */
  insights: InsightItem[];
  /** 渲染好的 insights 段落 */
  insightsText: string;
  /** 确定性 digest：每人发言次数/最近意图 */
  digest: string;
  estimatedTokens: number;
  includedMessageIds: string[];
  droppedMessageCount: number;
}

export interface AssembleOptions {
  purpose: ContextPurpose;
  budgetTokens?: number;
  fullWindow?: number;
  digestWindow?: number;
  /** 由 eligibility 决定；只影响渲染出来的"是否必须收尾" */
  mustClose?: boolean;
  /** 决策调用时把"可选发言者"排除在外的 message 不需要额外处理 */
  extraBudgetReserve?: number;
}

export function planFor(snapshot: DiscussionSnapshot, mustClose = false): TurnPlan {
  const coverageFloor = coverageFloorFor(snapshot.expertCount);
  const maxTurns = Math.min(MAX_TURNS, snapshot.maxTurns || MAX_TURNS);
  const turnIndex = Math.min(snapshot.turnCount + 1, maxTurns + 1);
  return {
    turnIndex,
    // 兼容字段：现在表示"覆盖保底"，不是目标轮次
    plannedTurns: coverageFloor,
    maxTurns,
    phase: mustClose ? "close" : phaseFor(turnIndex, coverageFloor),
    mustClose,
  };
}

export function phaseFor(turnIndex: number, plannedTurns: number): TurnPhase {
  if (turnIndex <= 1) return "open";
  // 到软目标后进入"可收束窗口"，是否真的收由主持人与饱和条件决定
  if (turnIndex >= plannedTurns) return "preclose";
  if (turnIndex === plannedTurns - 1) return "preclose";
  const ratio = turnIndex / plannedTurns;
  if (ratio <= 0.35) return "expand";
  if (ratio <= 0.72) return "clash";
  return "deepen";
}

export function personaLine(persona: ExpertPersona): string {
  const role = persona.role === "host" ? "主持" : "专家";
  return [
    `id=${persona.id}`,
    persona.name,
    persona.profession,
    `「${persona.title}」`,
    persona.stance,
    `轴：${persona.stanceAxis}`,
    `位置：${polarityLabel(persona.polarity)}`,
    `关注：${persona.focusArea}`,
    role,
  ].join(" | ");
}

export function polarityLabel(polarity: string): string {
  switch (polarity) {
    case "strong_oppose":
      return "强烈反对";
    case "oppose":
      return "反对";
    case "neutral":
      return "中立";
    case "support":
      return "支持";
    case "strong_support":
      return "强烈支持";
    default:
      return polarity;
  }
}

export function intentLabel(intent: Intent): string {
  switch (intent) {
    case "opening":
      return "开场";
    case "probe":
      return "追问";
    case "rebut":
      return "反驳";
    case "support":
      return "支持";
    case "extend":
      return "补充";
    case "clarify":
      return "澄清";
    case "mediate":
      return "串联";
    case "redirect":
      return "转向";
    case "summary":
      return "收尾";
    default:
      return intent;
  }
}

export function messageLine(message: TranscriptMessage): string {
  return `[${message.id}] ${message.speakerName}(${intentLabel(message.intent)})：${message.content}`;
}

function digestLine(message: TranscriptMessage): string {
  return `[${message.id}] ${message.speakerName}(${intentLabel(message.intent)})：${truncateChars(
    message.content,
    40,
  )}`;
}

export function assembleContext(
  snapshot: DiscussionSnapshot,
  options: AssembleOptions,
): ContextBundle {
  const purpose = options.purpose;
  const budget = options.budgetTokens ?? CONTEXT_BUDGET[purpose];
  const fullWindow = options.fullWindow ?? FULL_WINDOW;
  const digestWindow = options.digestWindow ?? DIGEST_WINDOW;

  const plan = planFor(snapshot, options.mustClose);
  const personas = snapshot.experts.map(personaLine).join("\n");
  const digest = buildDigest(snapshot);
  const insightsText = renderInsights(snapshot.insights);
  // 争论结构放在最前面：模型先看到"谁欠谁一个回答"，才不会退回角色扮演
  const debateMap = buildDebateMap(snapshot);
  const debateText = `${renderDebateMap(debateMap)}\n\n${renderSaturation(debateMap.saturation)}`;

  const ordered = [...snapshot.messages].sort((a, b) => b.turnIndex - a.turnIndex);
  const recent = ordered.slice(0, fullWindow);
  const older = ordered.slice(fullWindow, fullWindow + digestWindow);

  let transcript = recent.map(messageLine).join("\n");
  let olderDigest = older.map(digestLine).join("\n");

  const fixedBudget =
    estimateTokens(planText(plan, snapshot)) +
    estimateTokens(debateText) +
    estimateTokens(personas) +
    estimateTokens(insightsText) +
    estimateTokens(digest) +
    220; // 规则/任务段预留

  let estimated =
    fixedBudget + estimateTokens(transcript) + estimateTokens(olderDigest);

  // 超预算：先砍一行式，再砍全文窗口（从最旧砍起）
  const trimmedRecent = [...recent];
  const trimmedOlder = [...older];
  let dropped = 0;

  while (estimated > budget && trimmedOlder.length > 0) {
    trimmedOlder.pop();
    olderDigest = trimmedOlder.map(digestLine).join("\n");
    dropped += 1;
    estimated = fixedBudget + estimateTokens(transcript) + estimateTokens(olderDigest);
  }
  while (estimated > budget && trimmedRecent.length > 1) {
    trimmedRecent.pop();
    transcript = trimmedRecent.map(messageLine).join("\n");
    dropped += 1;
    estimated = fixedBudget + estimateTokens(transcript) + estimateTokens(olderDigest);
  }

  const includedMessageIds = [...trimmedRecent, ...trimmedOlder].map((m) => m.id);

  return {
    purpose,
    topic: snapshot.topic,
    plan,
    debateMap,
    debateText,
    personas,
    transcript,
    olderDigest,
    insights: snapshot.insights,
    insightsText,
    digest,
    estimatedTokens: estimated,
    includedMessageIds,
    droppedMessageCount: dropped,
  };
}

export function planText(plan: TurnPlan, snapshot: DiscussionSnapshot): string {
  const host = snapshot.experts.filter((e) => e.role === "host").length;
  return [
    `第 ${plan.turnIndex} 轮 / 覆盖保底 ${plan.plannedTurns} 轮 / 安全上限 ${plan.maxTurns} 轮`,
    `阶段：${phaseLabel(plan.phase)}`,
    `专家 ${snapshot.expertCount} 人 + 主持 ${host} 人`,
    `已完成发言 ${snapshot.turnCount} 条`,
    `现在必须收尾：${plan.mustClose ? "true" : "false"}`,
  ].join("\n");
}

export function phaseLabel(phase: TurnPhase): string {
  switch (phase) {
    case "open":
      return "开场";
    case "expand":
      return "铺开";
    case "clash":
      return "碰撞";
    case "deepen":
      return "深化";
    case "preclose":
      return "预收";
    case "close":
      return "收尾";
    default:
      return phase;
  }
}

export function buildDigest(snapshot: DiscussionSnapshot): string {
  const lines: string[] = [];
  for (const persona of snapshot.experts) {
    const own = snapshot.messages.filter((m) => m.expertId === persona.id);
    if (own.length === 0) {
      lines.push(`${persona.name}：尚未发言`);
      continue;
    }
    const last = own[own.length - 1];
    lines.push(
      `${persona.name}：${own.length} 次发言，最近一次是${intentLabel(last.intent)}`,
    );
  }
  return lines.join("\n");
}

export function renderInsights(insights: InsightItem[]): string {
  if (insights.length === 0) return "（暂无可靠的共识或分歧）";
  const groups: Record<string, string[]> = {
    consensus: [],
    divergence: [],
    open_question: [],
  };
  for (const item of insights) {
    const bucket = groups[item.type] ?? [];
    bucket.push(`[${item.id}] ${item.content}（依据：${item.evidenceMessageIds.join(", ")}）`);
  }
  const labels: Record<string, string> = {
    consensus: "共识",
    divergence: "分歧",
    open_question: "待验证",
  };
  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([type, items]) => `## ${labels[type]}\n${items.join("\n")}`)
    .join("\n");
}

/** 把 context 渲染成 prompt 里统一的段落；**争论结构在最前面**。 */
export function renderContextBlock(bundle: ContextBundle): string {
  const parts: string[] = [];
  parts.push(bundle.debateText);
  parts.push(`# 参会者（顺序不代表发言次序，先看上面的争论结构）\n${bundle.personas}`);
  parts.push(
    bundle.transcript
      ? `# 现场原文（新→旧，最多 ${FULL_WINDOW} 条）\n${bundle.transcript}`
      : "# 现场原文\n（还没有人发言）",
  );
  if (bundle.olderDigest) {
    parts.push(`# 更早的发言（一行式）\n${bundle.olderDigest}`);
  }
  parts.push(`# 每次发言的统计\n${bundle.digest}`);
  parts.push(`# 当前共识 / 分歧 / 待验证\n${bundle.insightsText}`);
  return parts.join("\n\n");
}
