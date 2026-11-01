import type { Intent } from "@ai-panel/shared";
import type { DiscussionSnapshot, ReasonCode, TurnDecision } from "../core/types";
import { buildDebateMap } from "../context/debate-map";
import { hash32, truncateChars } from "../core/text";
import type { Eligibility } from "./eligibility";

/**
 * 确定性兜底选人（模型不可用 / 决策不合法时使用）。
 * 关键要求：永不返回空、结果可复现（不依赖 Math.random）。
 */

export interface FallbackChoice {
  decision: TurnDecision;
  reasonCode: ReasonCode;
  score: number;
}

export interface FallbackOptions {
  turnFocus?: string;
}

const META_FOCUS = /我(认为|觉得|想)|先(分析|说)|第一步|因为|所以|需要(推理|思考)|让我/;

export function selectFallbackSpeaker(
  snapshot: DiscussionSnapshot,
  eligibility: Eligibility,
  options: FallbackOptions = {},
): FallbackChoice {
  const candidates = eligibility.allowedSpeakers;
  if (candidates.length === 0) {
    return {
      decision: {
        speakerId: snapshot.experts[0]?.id ?? "unknown",
        intent: "extend",
        turnFocus: "本轮的判断依据",
      },
      reasonCode: "fills_gap",
      score: 0,
    };
  }

  const lastMessage = snapshot.messages.at(-1);
  const lastSpeaker = lastMessage
    ? snapshot.experts.find((e) => e.id === lastMessage.expertId)
    : undefined;
  const lastAxis = lastSpeaker?.stanceAxis;
  const owesAnswer = new Set(eligibility.prioritySpeakerIds);
  const openChallengeFor = new Map<string, string>();
  for (const challenge of buildDebateMap(snapshot).openChallenges) {
    if (!openChallengeFor.has(challenge.toId)) openChallengeFor.set(challenge.toId, challenge.messageId);
  }

  const scored = candidates.map((candidate) => {
    let score = 0;
    // 谁欠谁一个回答：优先让被挑战的人接账（v2 的核心优先级）
    if (owesAnswer.has(candidate.id)) score += 3.2;
    if (candidate.speakCount === 0) score += 2.5;
    const turnsSince = turnsSinceLastSpoke(snapshot, candidate.id);
    score += Math.min(turnsSince, 4) * 0.35;
    if (lastSpeaker && candidate.id !== lastSpeaker.id) {
      if (candidate.polarity !== lastSpeaker.polarity) score += 1.5;
      if (lastAxis && candidate.stanceAxis !== lastAxis) score += 0.8;
      if (candidate.polarity === lastSpeaker.polarity) score -= 0.8;
    }
    score -= 0.6 * Math.min(candidate.speakCount, 8);
    if (candidate.role === "host") score -= 1.5;
    return { candidate, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ha = hash32(`${snapshot.discussionId}|${eligibility.turnIndex}|${a.candidate.id}`);
    const hb = hash32(`${snapshot.discussionId}|${eligibility.turnIndex}|${b.candidate.id}`);
    return ha.localeCompare(hb);
  });

  const chosen = scored[0].candidate;
  const owes = owesAnswer.has(chosen.id) ? openChallengeFor.get(chosen.id) : undefined;
  const intent = owes ? "rebut" : inferIntent(snapshot, eligibility, chosen.id);
  const targetMessageId = owes ?? (needsTarget(intent) ? targetFor(snapshot, chosen.id) : undefined);

  const turnFocus =
    options.turnFocus ?? focusFromAxis(chosen.stanceAxis) ?? "这一轮到底该争什么？";

  return {
    decision: {
      speakerId: chosen.id,
      intent,
      turnFocus,
      ...(targetMessageId ? { targetMessageId } : {}),
      action: eligibility.mustClose ? "close" : "next",
      reasonCode: eligibility.mustClose
        ? "closing"
        : owes
          ? "answer_challenge"
          : reasonFor(chosen.speakCount, intent),
    },
    reasonCode: eligibility.mustClose ? "closing" : owes ? "answer_challenge" : reasonFor(chosen.speakCount, intent),
    score: scored[0].score,
  };
}

export function inferIntent(
  snapshot: DiscussionSnapshot,
  eligibility: Eligibility,
  speakerId: string,
): Intent {
  if (eligibility.mustClose) return "summary";
  const speaker = snapshot.experts.find((e) => e.id === speakerId);
  if (!speaker) return "extend";
  if (speaker.role === "host") {
    if (!eligibility.host.openingDone) return "opening";
    if (eligibility.host.mediateUsed === 0 && snapshot.turnCount >= 4) return "mediate";
    if (eligibility.host.probeUsed === 0) return "probe";
    return "probe";
  }
  const last = snapshot.messages.at(-1);
  if (!last) return "extend";
  const lastSpeaker = snapshot.experts.find((e) => e.id === last.expertId);
  const speakCount = snapshot.messages.filter((m) => m.expertId === speakerId).length;
  if (speakCount === 0) return "extend";
  if (lastSpeaker && lastSpeaker.id !== speakerId) {
    if (lastSpeaker.polarity !== speaker.polarity) return "rebut";
    return "support";
  }
  return "extend";
}

function needsTarget(intent: Intent): boolean {
  return intent === "rebut" || intent === "support" || intent === "probe" || intent === "mediate";
}

function targetFor(snapshot: DiscussionSnapshot, speakerId: string): string | undefined {
  for (let i = snapshot.messages.length - 1; i >= 0; i -= 1) {
    const message = snapshot.messages[i];
    if (message.expertId !== speakerId) return message.id;
  }
  return undefined;
}

function turnsSinceLastSpoke(snapshot: DiscussionSnapshot, expertId: string): number {
  let turns = 0;
  for (let i = snapshot.messages.length - 1; i >= 0; i -= 1) {
    if (snapshot.messages[i].expertId === expertId) return turns;
    turns += 1;
  }
  return snapshot.messages.length;
}

/** 把立场轴改写成"争点"（turnFocus 要求是可争论的说法，不是名词标签）。 */
function focusFromAxis(axis: string): string | undefined {
  const trimmed = axis.trim().replace(/\s+vs\.?\s+/iu, "还是");
  if (trimmed.length < 4) return undefined;
  if (META_FOCUS.test(trimmed)) return undefined;
  if (/？$/u.test(trimmed)) return truncateChars(trimmed, 24, "");
  return `${truncateChars(trimmed, 22, "")}？`;
}

function reasonFor(speakCount: number, intent: Intent): ReasonCode {
  if (speakCount === 0) return "fresh_voice";
  if (intent === "rebut") return "direct_clash";
  if (intent === "mediate" || intent === "probe") return "follow_up";
  return "fills_gap";
}
