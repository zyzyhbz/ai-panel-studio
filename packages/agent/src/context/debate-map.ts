import type { Intent, InsightType } from "@ai-panel/shared";
import type { DiscussionSnapshot, InsightItem, TranscriptMessage } from "../core/types";
import { MIN_EXPERT_SPEAKS, STALE_WINDOW } from "../core/rounds";
import { char3GramJaccard, truncateChars } from "../core/text";

/**
 * 争论结构（debateMap）：**确定性投影，不调用 LLM**。
 *
 * 设计原则（PM 2026-11-01 纠正）：**讨论是否结束由观点/争点决定，轮数只是保底**。
 * 所以这个模块除了"谁欠谁一个回答"，还要给出 `saturation`——能不能收的确定性依据。
 *
 * 四个部分 + 一个判定：
 * 1. 未回应的挑战（openChallenges，区分"已承认未解决"）
 * 2. 各方当前主张（每人最近一条，防止角色小传）
 * 3. 尚未解决的张力（divergence / open_question，且未被双方回应）
 * 4. 被回避的前提（被追问后没人给条件/代价）
 * 5. saturation：ready / reasons / 四个计数
 */

export const MAX_UNANSWERED = 6;
export const MAX_TENSIONS = 4;
export const MAX_PREMISES = 3;

const RESPONSE_SIMILARITY = 0.22;
const BOUNDARY_MARKERS = /如果|条件|前提|取决于|代价|成本|边界|除非|只有|至少|风险|多少/;
const ACK_MARKERS = /承认|没法(回答|证明)|无法(回答|证明)|说不清|没有证据|暂时没有答案|保留意见|不能证明/;
const CHALLENGE_INTENTS: Intent[] = ["rebut", "probe"];

export interface UnansweredChallenge {
  messageId: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  intent: Intent;
  content: string;
  turnIndex: number;
  age: number;
  /** 对方已承认"这确实没解决"——不算欠账，但仍应出现在 unresolved 里 */
  acknowledged: boolean;
}

export interface DebateClaim {
  expertId: string;
  name: string;
  messageId: string;
  content: string;
  turnIndex: number;
  intent: Intent;
}

export interface Saturation {
  ready: boolean;
  /** 未满足项（中文，直接可进 prompt / 日志） */
  reasons: string[];
  /** 全部未回应的挑战（含已超窗口的旧账） */
  openChallengeCount: number;
  /** 最近窗口内、未被承认的挑战——只有这些阻塞收束 */
  blockingChallengeCount: number;
  /** 允许带进总结的"仍未解决"：超窗口的旧挑战 + 旧的未解决张力 */
  acceptedUnresolved: string[];
  /** 最近 4 轮里"还在产生新洞察"的轮数 */
  newClaimTurns: number;
  /** 已发言 ≥2 次的专家人数 */
  expertsSpokenTwice: number;
  /** 旧的未解决张力数（不阻塞收束，但要写进总结） */
  unresolvedTensions: number;
  /** 最近窗口内新增的张力数（阻塞收束） */
  newTensionCount: number;
  /** 主持人是否已做过张力指认/追问 */
  hostPressed: boolean;
}

export interface DebateMap {
  openChallenges: UnansweredChallenge[];
  /** 兼容旧字段名（未回应挑战） */
  unansweredChallenges: UnansweredChallenge[];
  claims: DebateClaim[];
  tensions: string[];
  avoidedPremises: string[];
  /** 欠回答的人（按积压时间排序） */
  answerOwners: string[];
  latestTurnIndex: number;
  saturation: Saturation;
}

export function buildDebateMap(snapshot: DiscussionSnapshot): DebateMap {
  const messages = [...snapshot.messages].sort((a, b) => a.turnIndex - b.turnIndex);
  const byId = new Map(messages.map((m) => [m.id, m]));
  const expertById = new Map(snapshot.experts.map((e) => [e.id, e]));
  const latestTurnIndex = snapshot.turnCount;
  const host = snapshot.experts.find((e) => e.role === "host");

  /* 1) 未回应 / 已承认未解决的挑战 */
  const challenges: UnansweredChallenge[] = [];
  for (const message of messages) {
    if (!CHALLENGE_INTENTS.includes(message.intent)) continue;
    const target = message.targetMessageId ? byId.get(message.targetMessageId) : undefined;
    if (!target) continue;
    if (target.expertId === message.expertId) continue;

    const later = messages.filter(
      (m) => m.turnIndex > message.turnIndex && m.expertId === target.expertId,
    );
    const answered = later.some((m) => {
      if (m.targetMessageId === message.id) return true;
      if ((m.references ?? []).includes(message.id)) return true;
      return char3GramJaccard(m.content, message.content) >= RESPONSE_SIMILARITY;
    });
    if (answered) continue;

    const acknowledged =
      later.some((m) => ACK_MARKERS.test(m.content)) ||
      messages.some((m) => m.turnIndex > message.turnIndex && ACK_MARKERS.test(m.content));

    const challenger = expertById.get(message.expertId);
    const targetSpeaker = expertById.get(target.expertId);
    challenges.push({
      messageId: message.id,
      fromId: message.expertId,
      fromName: challenger?.name ?? message.speakerName,
      toId: target.expertId,
      toName: targetSpeaker?.name ?? target.speakerName,
      intent: message.intent,
      content: message.content,
      turnIndex: message.turnIndex,
      age: Math.max(0, latestTurnIndex - message.turnIndex),
      acknowledged,
    });
  }
  challenges.sort((a, b) => b.age - a.age || a.turnIndex - b.turnIndex);

  /* 2) 各方当前主张 */
  const claims: DebateClaim[] = [];
  for (const expert of snapshot.experts) {
    if (expert.role !== "expert") continue;
    const own = messages.filter((m) => m.expertId === expert.id);
    const last = own.at(-1);
    if (!last) continue;
    claims.push({
      expertId: expert.id,
      name: expert.name,
      messageId: last.id,
      content: truncateChars(last.content, 40),
      turnIndex: last.turnIndex,
      intent: last.intent,
    });
  }

  /* 3) 尚未解决的张力 */
  const divergenceUnresolved = snapshot.insights
    .filter((i) => i.type === "divergence")
    .filter((i) => !divergenceCovered(snapshot, i));
  const openUnresolved = snapshot.insights
    .filter((i) => i.type === "open_question")
    .filter((i) => !questionAnswered(snapshot, i));

  const tensions = [
    ...divergenceUnresolved.map((i) => i.content),
    ...openUnresolved.map((i) => `（待验证）${i.content}`),
  ].slice(0, MAX_TENSIONS);

  /* 4) 被回避的前提：挑战之后没人谈条件/代价/边界 */
  const avoidedPremises = challenges
    .filter((challenge) => {
      const later = messages.filter((m) => m.turnIndex > challenge.turnIndex);
      return !later.some((m) => BOUNDARY_MARKERS.test(m.content));
    })
    .slice(0, MAX_PREMISES)
    .map((challenge) => {
      const head = truncateChars(challenge.content, 28);
      return `「${head}」被${challenge.fromName}${
        challenge.intent === "probe" ? "追问" : "反驳"
      }后，还没人给出条件或代价`;
    });

  const answerOwners: string[] = [];
  for (const challenge of challenges) {
    if (challenge.acknowledged) continue;
    if (!answerOwners.includes(challenge.toId)) answerOwners.push(challenge.toId);
  }

  /* 5) 饱和判定 */
  const saturation = computeSaturation(snapshot, {
    messages,
    insights: snapshot.insights,
    challenges,
    divergenceUnresolved,
    openUnresolved,
    hostPressed: Boolean(
      host && (hasIntent(messages, host.id, "probe") || hasIntent(messages, host.id, "mediate")),
    ),
  });

  return {
    openChallenges: challenges.filter((c) => !c.acknowledged).slice(0, MAX_UNANSWERED),
    unansweredChallenges: challenges.filter((c) => !c.acknowledged).slice(0, MAX_UNANSWERED),
    claims,
    tensions,
    avoidedPremises,
    answerOwners,
    latestTurnIndex,
    saturation,
  };
}

interface SaturationInput {
  messages: TranscriptMessage[];
  insights: InsightItem[];
  /** 全部挑战（含 acknowledged），由本函数按"是否超窗口"分流 */
  challenges: UnansweredChallenge[];
  divergenceUnresolved: InsightItem[];
  openUnresolved: InsightItem[];
  hostPressed: boolean;
}

/**
 * 饱和条件（五项全满足才算收敛）——**只要求"最近没有新东西"，不要求"把旧账清空"**。
 *
 * 1. 每位专家至少发言 2 次；
 * 2. 最近 `STALE_WINDOW` 轮内没有**阻塞性**挑战（超窗口的旧挑战、已承认未解决的，都允许进总结）；
 * 3. 最近 `STALE_WINDOW` 轮没有新洞察（旧的未解决张力允许保留）；
 * 4. 最近 `STALE_WINDOW` 轮没有**新增**张力（旧 divergence/open 不算）；
 * 5. 主持人至少做过 1 次张力指认或追问。
 *
 * 这样真实讨论才可能收敛：观点讨论本来就允许保留分歧，关键是"还在不在产生新东西"。
 */
export function computeSaturation(snapshot: DiscussionSnapshot, input: SaturationInput): Saturation {
  const experts = snapshot.experts.filter((e) => e.role === "expert");
  const counts = new Map<string, number>();
  for (const message of input.messages) {
    counts.set(message.expertId, (counts.get(message.expertId) ?? 0) + 1);
  }
  const expertsSpokenTwice = experts.filter((e) => (counts.get(e.id) ?? 0) >= MIN_EXPERT_SPEAKS).length;
  const coverageOk = experts.length > 0 && expertsSpokenTwice === experts.length;

  const latestTurn = snapshot.turnCount;
  const cutoff = latestTurn - STALE_WINDOW;

  const open = input.challenges.filter((c) => !c.acknowledged);
  const blockingChallenges = open.filter((c) => c.age <= STALE_WINDOW);
  const oldChallenges = open.filter((c) => c.age > STALE_WINDOW);

  const newInsights = input.insights.filter((i) => i.firstSeenTurn > cutoff);
  const newInsightTurns = new Set(newInsights.map((i) => i.firstSeenTurn));
  const newTensions = input.insights.filter(
    (i) => (i.type === "divergence" || i.type === "open_question") && i.firstSeenTurn > cutoff,
  );

  // 只在"已经跑过窗口"之后才可能 stale，避免前几轮误判
  const staleOk = latestTurn > STALE_WINDOW && newInsightTurns.size === 0;
  const tensionsOk = newTensions.length === 0;

  const unresolvedTensions = input.divergenceUnresolved.length + input.openUnresolved.length;

  // 允许带进总结的"仍未解决"：超窗口旧挑战 + 旧的未解决张力
  const acceptedUnresolved = [
    ...oldChallenges.map(
      (c) => `「${truncateChars(c.content, 26)}」由${c.fromName}提出，${c.toName}未正面回答`,
    ),
    ...input.divergenceUnresolved.map((i) => i.content),
    ...input.openUnresolved.map((i) => `（待验证）${i.content}`),
  ].slice(0, 6);

  const reasons: string[] = [];
  if (!coverageOk) {
    const laggards = experts
      .filter((e) => (counts.get(e.id) ?? 0) < MIN_EXPERT_SPEAKS)
      .map((e) => `${e.name}${counts.get(e.id) ?? 0}次`);
    reasons.push(`发言不足 2 次的专家：${laggards.join("、") || "无"}`);
  }
  if (blockingChallenges.length > 0) {
    reasons.push(`最近 ${STALE_WINDOW} 轮有 ${blockingChallenges.length} 个挑战还没被回应`);
  }
  if (!staleOk) reasons.push(`最近 ${STALE_WINDOW} 轮仍在产生新洞察`);
  if (!tensionsOk) reasons.push(`最近 ${STALE_WINDOW} 轮新增了 ${newTensions.length} 个张力`);
  if (!input.hostPressed) reasons.push("主持人还没做过张力指认或追问");

  const ready =
    coverageOk &&
    blockingChallenges.length === 0 &&
    staleOk &&
    tensionsOk &&
    input.hostPressed;

  return {
    ready,
    reasons,
    openChallengeCount: open.length,
    blockingChallengeCount: blockingChallenges.length,
    acceptedUnresolved,
    newClaimTurns: newInsightTurns.size,
    expertsSpokenTwice,
    unresolvedTensions,
    newTensionCount: newTensions.length,
    hostPressed: input.hostPressed,
  };
}

function divergenceCovered(snapshot: DiscussionSnapshot, insight: InsightItem): boolean {
  const evidenceIds = new Set(insight.evidenceMessageIds);
  const evidence = snapshot.messages.filter((m) => evidenceIds.has(m.id));
  const speakers = new Set(evidence.map((m) => m.expertId));
  if (speakers.size < 2) return false;
  for (const speaker of speakers) {
    const responded = snapshot.messages.some(
      (m) =>
        m.expertId === speaker &&
        m.turnIndex > insight.firstSeenTurn &&
        ((m.targetMessageId && evidenceIds.has(m.targetMessageId)) ||
          (m.references ?? []).some((r) => evidenceIds.has(r)) ||
          char3GramJaccard(m.content, insight.content) >= RESPONSE_SIMILARITY),
    );
    if (!responded) return false;
  }
  return true;
}

function questionAnswered(snapshot: DiscussionSnapshot, insight: InsightItem): boolean {
  return snapshot.messages.some(
    (m) =>
      m.turnIndex > insight.firstSeenTurn &&
      (char3GramJaccard(m.content, insight.content) >= RESPONSE_SIMILARITY ||
        ACK_MARKERS.test(m.content)),
  );
}

function hasIntent(messages: TranscriptMessage[], expertId: string, intent: Intent): boolean {
  return messages.some((m) => m.expertId === expertId && m.intent === intent);
}

export function isEmptyDebateMap(map: DebateMap): boolean {
  return (
    map.openChallenges.length === 0 &&
    map.claims.length === 0 &&
    map.tensions.length === 0 &&
    map.avoidedPremises.length === 0
  );
}

/** 渲染成 prompt 段落；放在 persona **之前**（先看争论结构，再看人设）。 */
export function renderDebateMap(map: DebateMap): string {
  if (isEmptyDebateMap(map)) {
    return "# 当前争论结构\n（还没有形成争论，先把观点摆出来）";
  }

  const parts: string[] = ["# 当前争论结构（先看这个，再看人设）"];

  if (map.openChallenges.length > 0) {
    const lines = map.openChallenges.map(
      (c) =>
        `- [${c.messageId}] ${c.fromName}(${c.intent === "probe" ? "追问" : "反驳"})→${c.toName}：${truncateChars(
          c.content,
          36,
        )}（积压 ${c.age} 轮）`,
    );
    parts.push(`## 未回应的挑战（谁欠谁一个回答）\n${lines.join("\n")}`);
  } else {
    parts.push("## 未回应的挑战\n（没有积压）");
  }

  if (map.claims.length > 0) {
    const lines = map.claims.map(
      (claim) => `- ${claim.name}：${claim.content}（第 ${claim.turnIndex} 轮，${claim.messageId}）`,
    );
    parts.push(`## 各方当前主张\n${lines.join("\n")}`);
  }

  if (map.tensions.length > 0) {
    parts.push(`## 尚未解决的张力\n${map.tensions.map((t) => `- ${t}`).join("\n")}`);
  }

  if (map.avoidedPremises.length > 0) {
    parts.push(`## 被回避的前提\n${map.avoidedPremises.map((p) => `- ${p}`).join("\n")}`);
  }

  return parts.join("\n\n");
}

export function renderSaturation(saturation: Saturation): string {
  const state = saturation.ready ? "已收敛" : "未收敛";
  const lines = [
    `- 专家已发言≥2 次：${saturation.expertsSpokenTwice}`,
    `- 阻塞性挑战（最近 ${STALE_WINDOW} 轮）：${saturation.blockingChallengeCount}`,
    `- 可带进总结的旧账：${saturation.acceptedUnresolved.length}`,
    `- 最近 ${STALE_WINDOW} 轮新增洞察/张力：${saturation.newClaimTurns} / ${saturation.newTensionCount}`,
    `- 主持人已指认张力/追问：${saturation.hostPressed ? "是" : "否"}`,
  ];
  if (!saturation.ready && saturation.reasons.length > 0) {
    lines.push(`- 还差：${saturation.reasons.join("；")}`);
  }
  return `## 争论收敛度（${state}）\n${lines.join("\n")}`;
}

/** 供 decision 判断"这一轮谁最该说话"的轻量统计。 */
export function challengeTargets(map: DebateMap): Array<{ expertId: string; weight: number }> {
  const weights = new Map<string, number>();
  for (const challenge of map.openChallenges) {
    const weight = Math.min(3, 1 + challenge.age * 0.25);
    weights.set(challenge.toId, (weights.get(challenge.toId) ?? 0) + weight);
  }
  return [...weights.entries()]
    .map(([expertId, weight]) => ({ expertId, weight }))
    .sort((a, b) => b.weight - a.weight);
}

/** 一段话是否引入了"新东西"（用于 eval 的新论点率与重复判定）。 */
export function isLikelyNovel(content: string, previous: TranscriptMessage[]): boolean {
  if (!content) return false;
  return previous.every((m) => char3GramJaccard(content, m.content) < 0.5);
}

export type { InsightType };
