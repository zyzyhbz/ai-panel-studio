import type { Intent, Polarity } from "@ai-panel/shared";
import type {
  CloseReason,
  DiscussionSnapshot,
  ExpertPersona,
  TurnPhase,
} from "../core/types";
import { phaseFor } from "../context/assemble";

/**
 * 准入集与义务（AR-03 的"守卫"部分）。
 *
 * 模型只能在 `allowedSpeakers` 里挑人；这里同时负责：
 * - 连续发言上限、单专家上限、主持配额；
 * - 覆盖义务（有人一次没说话时强制优先）；
 * - 收尾判定（hard cap / planned / early stop）。
 */

export const HOST_TURN_LIMIT = 4;
export const CONSECUTIVE_HARD_LIMIT = 2;
export const EXPERT_CAP_EXTRA = 1;

export interface AllowedSpeaker {
  id: string;
  name: string;
  role: ExpertPersona["role"];
  speakCount: number;
  consecutiveCount: number;
  lastIntent?: Intent;
  polarity: Polarity;
  stanceAxis: string;
}

export interface HostQuota {
  used: number;
  limit: number;
  openingDone: boolean;
  probeUsed: number;
  mediateUsed: number;
  redirectUsed: number;
  summaryDone: boolean;
}

export type ForcedReason = "opening" | "coverage" | "close";

export interface Eligibility {
  turnIndex: number;
  plannedTurns: number;
  maxTurns: number;
  phase: TurnPhase;
  mustClose: boolean;
  closeReason?: CloseReason;
  allowedSpeakers: AllowedSpeaker[];
  host: HostQuota;
  neverSpoken: string[];
  forcedSpeakerId?: string;
  forcedReason?: ForcedReason;
  /** 被剔除的候选与原因（只进日志，不进 prompt） */
  exempted: Array<{ id: string; reason: string }>;
}

export function buildEligibility(snapshot: DiscussionSnapshot): Eligibility {
  const experts = snapshot.experts.filter((e) => e.role === "expert");
  const host = snapshot.experts.find((e) => e.role === "host");
  const n = experts.length || snapshot.expertCount;
  const turnIndex = snapshot.turnCount + 1;

  const counts = new Map<string, number>();
  for (const message of snapshot.messages) {
    counts.set(message.expertId, (counts.get(message.expertId) ?? 0) + 1);
  }
  const neverSpoken = experts.filter((e) => !counts.get(e.id)).map((e) => e.id);

  const hostQuota = hostQuotaOf(snapshot, host);
  const closeReason = evaluateClose(snapshot, turnIndex, neverSpoken, hostQuota);
  const mustClose = closeReason !== undefined;
  const phase = mustClose ? "close" : phaseFor(turnIndex, snapshot.plannedTurns);

  const exempted: Array<{ id: string; reason: string }> = [];
  const expertSlots = Math.max(1, snapshot.plannedTurns - hostQuota.used);
  const expertCap = Math.ceil(expertSlots / Math.max(1, n)) + EXPERT_CAP_EXTRA;

  const lastSpeakerId = snapshot.messages.at(-1)?.expertId;
  const lastSpeakerConsecutive = lastSpeakerId ? consecutiveTail(snapshot, lastSpeakerId) : 0;

  let candidates: AllowedSpeaker[] = experts.map((e) => ({
    id: e.id,
    name: e.name,
    role: e.role,
    speakCount: counts.get(e.id) ?? 0,
    consecutiveCount: e.id === lastSpeakerId ? lastSpeakerConsecutive : 0,
    lastIntent: lastIntentOf(snapshot, e.id),
    polarity: e.polarity,
    stanceAxis: e.stanceAxis,
  }));

  candidates = candidates.filter((candidate) => {
    if (candidate.speakCount >= expertCap) {
      exempted.push({ id: candidate.id, reason: `已达单人上限 ${expertCap}` });
      return false;
    }
    if (candidate.consecutiveCount >= CONSECUTIVE_HARD_LIMIT) {
      exempted.push({ id: candidate.id, reason: `连续发言 ${candidate.consecutiveCount} 次` });
      return false;
    }
    return true;
  });

  // 全部被剔除时放宽连续限制（宁可重复，也不能空轮）
  if (candidates.length === 0) {
    candidates = experts.map((e) => ({
      id: e.id,
      name: e.name,
      role: e.role,
      speakCount: counts.get(e.id) ?? 0,
      consecutiveCount: e.id === lastSpeakerId ? lastSpeakerConsecutive : 0,
      lastIntent: lastIntentOf(snapshot, e.id),
      polarity: e.polarity,
      stanceAxis: e.stanceAxis,
    }));
    exempted.push({ id: "*", reason: "候选集为空，放宽连续限制" });
  }

  const hostAllowed = host ? shouldAllowHost(turnIndex, snapshot.plannedTurns, hostQuota, neverSpoken) : false;
  if (host && hostAllowed) {
    candidates.push({
      id: host.id,
      name: host.name,
      role: host.role,
      speakCount: counts.get(host.id) ?? 0,
      consecutiveCount: host.id === lastSpeakerId ? lastSpeakerConsecutive : 0,
      lastIntent: lastIntentOf(snapshot, host.id),
      polarity: host.polarity,
      stanceAxis: host.stanceAxis,
    });
  } else if (host) {
    exempted.push({ id: host.id, reason: "当前阶段不需要主持人发言" });
  }

  let forcedSpeakerId: string | undefined;
  let forcedReason: ForcedReason | undefined;

  if (mustClose && host) {
    forcedSpeakerId = host.id;
    forcedReason = "close";
  } else if (turnIndex === 1 && host) {
    forcedSpeakerId = host.id;
    forcedReason = "opening";
  } else if (neverSpoken.length > 0 && turnIndex >= Math.ceil(n / 2)) {
    const pending = [...neverSpoken].sort((a, b) => {
      const ca = counts.get(a) ?? 0;
      const cb = counts.get(b) ?? 0;
      if (ca !== cb) return ca - cb;
      return a.localeCompare(b);
    });
    forcedSpeakerId = pending[0];
    forcedReason = "coverage";
  }

  let allowed = candidates;
  if (forcedSpeakerId) {
    const forced = candidates.find((c) => c.id === forcedSpeakerId);
    if (forced) allowed = [forced];
    else {
      // 强制对象被剔除（例如已连续 2 次）：退回完整候选集，交给模型/兜底
      forcedSpeakerId = undefined;
      forcedReason = undefined;
    }
  }

  return {
    turnIndex,
    plannedTurns: snapshot.plannedTurns,
    maxTurns: snapshot.maxTurns,
    phase,
    mustClose,
    closeReason,
    allowedSpeakers: allowed,
    host: hostQuota,
    neverSpoken,
    forcedSpeakerId,
    forcedReason,
    exempted,
  };
}

export function hostQuotaOf(
  snapshot: DiscussionSnapshot,
  host: ExpertPersona | undefined,
): HostQuota {
  const quota: HostQuota = {
    used: 0,
    limit: HOST_TURN_LIMIT,
    openingDone: false,
    probeUsed: 0,
    mediateUsed: 0,
    redirectUsed: 0,
    summaryDone: false,
  };
  if (!host) return quota;
  for (const message of snapshot.messages) {
    if (message.expertId !== host.id) continue;
    quota.used += 1;
    switch (message.intent) {
      case "opening":
        quota.openingDone = true;
        break;
      case "probe":
        quota.probeUsed += 1;
        break;
      case "mediate":
        quota.mediateUsed += 1;
        break;
      case "redirect":
        quota.redirectUsed += 1;
        break;
      case "summary":
        quota.summaryDone = true;
        break;
      default:
        break;
    }
  }
  return quota;
}

function shouldAllowHost(
  turnIndex: number,
  plannedTurns: number,
  quota: HostQuota,
  neverSpoken: string[],
): boolean {
  if (quota.used >= quota.limit) return false;
  if (!quota.openingDone) return true;
  if (quota.probeUsed === 0 && turnIndex <= Math.ceil(plannedTurns * 0.45)) return true;
  if (quota.mediateUsed === 0 && turnIndex >= 3 && turnIndex <= Math.ceil(plannedTurns * 0.8)) {
    return true;
  }
  if (quota.redirectUsed === 0 && neverSpoken.length > 0 && turnIndex <= Math.ceil(plannedTurns * 0.6)) {
    return true;
  }
  return false;
}

export function consecutiveTail(snapshot: DiscussionSnapshot, expertId: string): number {
  let count = 0;
  for (let i = snapshot.messages.length - 1; i >= 0; i -= 1) {
    const message = snapshot.messages[i];
    if (message.expertId !== expertId) break;
    count += 1;
  }
  return count;
}

function lastIntentOf(snapshot: DiscussionSnapshot, expertId: string): Intent | undefined {
  for (let i = snapshot.messages.length - 1; i >= 0; i -= 1) {
    if (snapshot.messages[i].expertId === expertId) return snapshot.messages[i].intent;
  }
  return undefined;
}

/**
 * 收尾判定：
 * - hard_cap：超过硬上限，必须收；
 * - planned_reached：到达计划轮次；
 * - early_stop：≥8 轮、全员发过言、主持义务完成、且已有共识与分歧。
 */
export function evaluateClose(
  snapshot: DiscussionSnapshot,
  turnIndex: number,
  neverSpoken: string[],
  quota: HostQuota,
): CloseReason | undefined {
  if (turnIndex > snapshot.maxTurns) return "hard_cap";
  if (turnIndex >= snapshot.plannedTurns) return "planned_reached";
  if (turnIndex < 8) return undefined;
  if (neverSpoken.length > 0) return undefined;
  if (!quota.probeUsed || !quota.mediateUsed) return undefined;
  const hasConsensus = snapshot.insights.some((i) => i.type === "consensus");
  const hasDivergence = snapshot.insights.some((i) => i.type === "divergence");
  if (!hasConsensus || !hasDivergence) return undefined;
  return "early_stop";
}

/** 收尾时主持人该用哪个 intent。 */
export function closingIntent(): Intent {
  return "summary";
}

/** 当前阶段推荐的作用力（给 prompt 用，不作为硬限制）。 */
export function preferredIntents(phase: TurnPhase, role: ExpertPersona["role"]): Intent[] {
  if (role === "host") {
    switch (phase) {
      case "open":
        return ["opening"];
      case "expand":
        return ["probe", "redirect"];
      case "clash":
        return ["mediate", "probe"];
      case "deepen":
        return ["probe", "mediate"];
      case "preclose":
      case "close":
        return ["summary"];
      default:
        return ["probe"];
    }
  }
  switch (phase) {
    case "expand":
      return ["extend", "support", "rebut"];
    case "clash":
      return ["rebut", "clarify", "support"];
    case "deepen":
      return ["extend", "clarify", "support"];
    default:
      return ["extend", "rebut", "support"];
  }
}
