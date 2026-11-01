import type { Intent, Polarity } from "@ai-panel/shared";
import type { CloseReason, DiscussionSnapshot, ExpertPersona, TurnPhase } from "../core/types";
import { MAX_TURNS, coverageFloorFor } from "../core/rounds";
import { buildDebateMap, type DebateMap, type Saturation } from "../context/debate-map";

/**
 * 准入集、义务与收束判定（AR-03 的"守卫"部分）。
 *
 * **收敛以观点为准，轮数只是保底**（PM 2026-11-01 纠正）：
 * - `coverageFloor = min(12, 2n+2)`：这是"不能早于"的下限，不是目标；
 * - `maxTurns = 36`：安全上限，到点必须收并列出未解决争点；
 * - 主收束信号 = `debateMap.saturation.ready`（五项全满足），不受任何"计划轮次"影响。
 */

export const HOST_TURN_MIN = 4;
export const HOST_TURN_MAX = 6;
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
  /** 覆盖保底（不能早于它收） */
  coverageFloor: number;
  maxTurns: number;
  phase: TurnPhase;
  /** 是否已过保底、允许收束 */
  canClose: boolean;
  /** 饱和 或 到硬上限（真的该收了） */
  mustClose: boolean;
  closeReason?: CloseReason;
  saturation: Saturation;
  allowedSpeakers: AllowedSpeaker[];
  host: HostQuota;
  neverSpoken: string[];
  /** 欠回答的人：未回应挑战的 target（按积压时间排序），供决策优先选人 */
  prioritySpeakerIds: string[];
  openChallengeCount: number;
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
  const maxTurns = Math.min(MAX_TURNS, snapshot.maxTurns || MAX_TURNS);
  const coverageFloor = coverageFloorFor(n);

  const counts = new Map<string, number>();
  for (const message of snapshot.messages) {
    counts.set(message.expertId, (counts.get(message.expertId) ?? 0) + 1);
  }
  const neverSpoken = experts.filter((e) => !counts.get(e.id)).map((e) => e.id);

  const hostQuota = hostQuotaOf(snapshot, host);
  const debateMap = buildDebateMap(snapshot);
  const saturation = debateMap.saturation;
  const canClose = turnIndex > coverageFloor;
  const closeReason = evaluateClose(turnIndex, maxTurns, canClose, saturation);
  const mustClose = closeReason !== undefined;
  const phase: TurnPhase = mustClose
    ? "close"
    : turnIndex <= 1
      ? "open"
      : turnIndex <= Math.ceil(coverageFloor * 0.45)
        ? "expand"
        : turnIndex <= coverageFloor
          ? "clash"
          : "deepen";

  const exempted: Array<{ id: string; reason: string }> = [];
  const expertCap = Math.max(
    4,
    Math.ceil((maxTurns - hostQuota.limit) / Math.max(1, n)) + EXPERT_CAP_EXTRA,
  );

  const lastSpeakerId = snapshot.messages.at(-1)?.expertId;
  const lastSpeakerConsecutive = lastSpeakerId ? consecutiveTail(snapshot, lastSpeakerId) : 0;

  const buildCandidate = (expert: ExpertPersona): AllowedSpeaker => ({
    id: expert.id,
    name: expert.name,
    role: expert.role,
    speakCount: counts.get(expert.id) ?? 0,
    consecutiveCount: expert.id === lastSpeakerId ? lastSpeakerConsecutive : 0,
    lastIntent: lastIntentOf(snapshot, expert.id),
    polarity: expert.polarity,
    stanceAxis: expert.stanceAxis,
  });

  let candidates: AllowedSpeaker[] = experts.map(buildCandidate);

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

  if (candidates.length === 0) {
    candidates = experts.map(buildCandidate);
    exempted.push({ id: "*", reason: "候选集为空，放宽连续限制" });
  }

  // 收尾轮必须包含主持人：否则 forcedSpeaker 找不到人，会退回"全是专家"的候选集
  const hostAllowed = host
    ? mustClose || shouldAllowHost(turnIndex, coverageFloor, hostQuota, neverSpoken)
    : false;
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
      forcedSpeakerId = undefined;
      forcedReason = undefined;
    }
  }

  const prioritySpeakerIds = debateMap.answerOwners.filter((id) =>
    allowed.some((candidate) => candidate.id === id),
  );

  return {
    turnIndex,
    coverageFloor,
    maxTurns,
    phase,
    canClose,
    mustClose,
    closeReason,
    saturation,
    allowedSpeakers: allowed,
    host: hostQuota,
    neverSpoken,
    prioritySpeakerIds,
    openChallengeCount: debateMap.openChallenges.length,
    forcedSpeakerId,
    forcedReason,
    exempted,
  };
}

export function hostQuotaOf(
  snapshot: DiscussionSnapshot,
  host: ExpertPersona | undefined,
): HostQuota {
  const limit = hostTurnLimit(snapshot.maxTurns || MAX_TURNS);
  const quota: HostQuota = {
    used: 0,
    limit,
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

/** 主持席位随安全上限放大：36 轮给 6。 */
export function hostTurnLimit(maxTurns: number): number {
  return Math.max(HOST_TURN_MIN, Math.min(HOST_TURN_MAX, Math.round(maxTurns / 6)));
}

function shouldAllowHost(
  turnIndex: number,
  coverageFloor: number,
  quota: HostQuota,
  neverSpoken: string[],
): boolean {
  if (quota.used >= quota.limit) return false;
  if (!quota.openingDone) return true;
  if (quota.probeUsed === 0 && turnIndex <= Math.ceil(coverageFloor * 0.6)) return true;
  if (quota.mediateUsed === 0 && turnIndex >= 3 && turnIndex <= coverageFloor + 4) return true;
  if (quota.redirectUsed === 0 && neverSpoken.length > 0 && turnIndex <= coverageFloor) return true;
  // 保底之后允许主持人再"施压"：还有积压张力时出手
  if (quota.used < quota.limit - 1) return true;
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
 * - `hard_cap`：到达安全上限（36），必须收；
 * - `saturated`：过了覆盖保底、且饱和五项全满足，可以收。
 *
 * **不看 plannedTurns**：轮数不是目标，只有保底与上限两个作用。
 */
export function evaluateClose(
  turnIndex: number,
  maxTurns: number,
  canClose: boolean,
  saturation: Saturation,
): CloseReason | undefined {
  if (turnIndex >= maxTurns) return "hard_cap";
  if (canClose && saturation.ready) return "saturated";
  return undefined;
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
        return ["probe", "mediate"];
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
      return ["clarify", "rebut", "extend"];
    default:
      return ["extend", "rebut", "support"];
  }
}

export type { DebateMap };
