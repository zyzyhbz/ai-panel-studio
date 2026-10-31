import { EXPERT_INTENTS, HOST_INTENTS } from "@ai-panel/shared";
import type { Intent } from "@ai-panel/shared";
import type { DiscussionSnapshot, TurnDecision } from "../core/types";
import type { Eligibility } from "./eligibility";
import { selectFallbackSpeaker } from "./fallback";

/**
 * 决策校验与修复。
 *
 * 分工：
 * - `validateDecision`：严格判定（测试/QA 用），不改写；
 * - `sanitizeDecision`：生产用，永远返回一个可执行决策（必要时换人/降级意图）。
 */

export type DecisionIssueCode =
  | "SPEAKER_NOT_ALLOWED"
  | "INTENT_NOT_ALLOWED"
  | "TARGET_REQUIRED"
  | "TARGET_INVALID"
  | "FOCUS_INVALID"
  | "CLOSE_NOT_ALLOWED";

export interface DecisionIssue {
  code: DecisionIssueCode;
  detail: string;
}

export interface DecisionValidation {
  ok: boolean;
  issues: DecisionIssue[];
}

const META_FOCUS = /我(认为|觉得|想)|先(分析|说)|第一步|因为|所以|需要(推理|思考)|让我/;
const ACTION_FOCUS = /^(反驳|支持|补充|澄清|追问|串联|转向|收尾)/;
const TARGET_REQUIRED: Intent[] = ["rebut", "support", "probe", "mediate"];

export function validateDecision(
  decision: TurnDecision,
  snapshot: DiscussionSnapshot,
  eligibility: Eligibility,
): DecisionValidation {
  const issues: DecisionIssue[] = [];
  const speaker = snapshot.experts.find((e) => e.id === decision.speakerId);

  if (!speaker || !eligibility.allowedSpeakers.some((c) => c.id === decision.speakerId)) {
    issues.push({
      code: "SPEAKER_NOT_ALLOWED",
      detail: `${decision.speakerId} 不在本轮可选发言者内`,
    });
  }

  const allowedIntents: readonly Intent[] =
    speaker?.role === "host" ? HOST_INTENTS : EXPERT_INTENTS;
  if (!allowedIntents.includes(decision.intent)) {
    issues.push({
      code: "INTENT_NOT_ALLOWED",
      detail: `${speaker?.role ?? "?"} 不允许使用 ${decision.intent}`,
    });
  }

  if (eligibility.mustClose && decision.intent !== "summary") {
    issues.push({ code: "CLOSE_NOT_ALLOWED", detail: "已到收尾轮，必须 intent=summary" });
  }
  if (!eligibility.mustClose && decision.intent === "summary") {
    issues.push({ code: "CLOSE_NOT_ALLOWED", detail: "未到收尾轮，不能提前 summary" });
  }

  if (TARGET_REQUIRED.includes(decision.intent) && !decision.targetMessageId) {
    issues.push({ code: "TARGET_REQUIRED", detail: `${decision.intent} 必须给 targetMessageId` });
  }

  if (decision.targetMessageId) {
    const target = snapshot.messages.find((m) => m.id === decision.targetMessageId);
    if (!target) {
      issues.push({
        code: "TARGET_INVALID",
        detail: `targetMessageId ${decision.targetMessageId} 不存在`,
      });
    } else if (target.expertId === decision.speakerId && decision.intent !== "clarify") {
      issues.push({ code: "TARGET_INVALID", detail: "不能指向自己（clarify 除外）" });
    }
  }

  if (decision.intent === "mediate") {
    const refs = decision.references ?? [];
    const speakers = new Set(
      refs
        .map((id) => snapshot.messages.find((m) => m.id === id)?.expertId)
        .filter((id): id is string => Boolean(id)),
    );
    if (speakers.size < 2) {
      issues.push({ code: "TARGET_INVALID", detail: "mediate 的 references 需覆盖两位不同专家" });
    }
  }

  const focusIssue = validateTurnFocus(decision.turnFocus);
  if (focusIssue) issues.push({ code: "FOCUS_INVALID", detail: focusIssue });

  return { ok: issues.length === 0, issues };
}

export function validateTurnFocus(turnFocus: string): string | null {
  const text = turnFocus.trim();
  if (text.length < 2) return "turnFocus 太短";
  if (text.length > 20) return "turnFocus 超过 20 字";
  if (META_FOCUS.test(text)) return "turnFocus 出现了思考过程用语";
  if (ACTION_FOCUS.test(text)) return "turnFocus 写成了发言动作，应写关注点";
  if (/[。！？!?]$/u.test(text)) return "turnFocus 不应带句末标点";
  return null;
}

export interface SanitizeResult {
  decision: TurnDecision;
  repaired: boolean;
  issues: DecisionIssue[];
}

/**
 * 生产路径：先按校验修复，修不动就整体走确定性兜底。
 * 任何情况下都返回一个 speakerId 在准入集内的决策。
 */
export function sanitizeDecision(
  decision: TurnDecision,
  snapshot: DiscussionSnapshot,
  eligibility: Eligibility,
): SanitizeResult {
  const issues: DecisionIssue[] = [];
  const allowed = eligibility.allowedSpeakers;
  const speaker = snapshot.experts.find((e) => e.id === decision.speakerId);
  const speakerAllowed = Boolean(speaker) && allowed.some((c) => c.id === decision.speakerId);

  if (!speakerAllowed) {
    const fallback = selectFallbackSpeaker(snapshot, eligibility);
    return {
      decision: fallback.decision,
      repaired: true,
      issues: [
        {
          code: "SPEAKER_NOT_ALLOWED",
          detail: `${decision.speakerId} 不在可选集内，已切换为 ${fallback.decision.speakerId}`,
        },
      ],
    };
  }

  const allowedIntents: readonly Intent[] =
    speaker?.role === "host" ? HOST_INTENTS : EXPERT_INTENTS;
  let intent = decision.intent;
  if (!allowedIntents.includes(intent)) {
    issues.push({ code: "INTENT_NOT_ALLOWED", detail: `${intent} 不适用于该角色，降级为 extend` });
    intent = "extend";
  }
  if (eligibility.mustClose && intent !== "summary") {
    issues.push({ code: "CLOSE_NOT_ALLOWED", detail: "到达收尾轮，强制 summary" });
    intent = "summary";
  }
  if (!eligibility.mustClose && intent === "summary") {
    issues.push({ code: "CLOSE_NOT_ALLOWED", detail: "未到收尾轮，summary 降级为 extend" });
    intent = "extend";
  }

  let targetMessageId = decision.targetMessageId;
  if (targetMessageId) {
    const target = snapshot.messages.find((m) => m.id === targetMessageId);
    const selfTarget = target?.expertId === decision.speakerId;
    if (!target || (selfTarget && intent !== "clarify")) {
      issues.push({
        code: "TARGET_INVALID",
        detail: `${targetMessageId} 不可用，已移除并降级为 extend`,
      });
      targetMessageId = undefined;
      if (intent !== "clarify") intent = "extend";
    }
  }
  if (TARGET_REQUIRED.includes(intent) && !targetMessageId) {
    const candidate = lastOtherMessage(snapshot, decision.speakerId);
    if (candidate) {
      targetMessageId = candidate.id;
      issues.push({ code: "TARGET_REQUIRED", detail: `${intent} 缺 target，已补最近他人发言` });
    } else {
      issues.push({ code: "TARGET_REQUIRED", detail: "无他人发言可引用，降级为 extend" });
      intent = "extend";
    }
  }

  let references = decision.references?.filter((id) =>
    snapshot.messages.some((m) => m.id === id),
  );
  if (intent === "mediate") {
    const refs = references ?? [];
    const speakers = new Set(
      refs
        .map((id) => snapshot.messages.find((m) => m.id === id)?.expertId)
        .filter((id): id is string => Boolean(id)),
    );
    if (speakers.size < 2) {
      const pair = twoSpeakerReferences(snapshot);
      if (pair) {
        references = pair;
        issues.push({ code: "TARGET_INVALID", detail: "mediate 的 references 已补齐两位专家" });
      }
    }
  }

  let turnFocus = decision.turnFocus?.trim() ?? "";
  const focusIssue = validateTurnFocus(turnFocus);
  if (focusIssue) {
    turnFocus = fallbackFocus(speaker?.stanceAxis, snapshot);
    issues.push({ code: "FOCUS_INVALID", detail: `${focusIssue}，已替换` });
  }

  const sanitized: TurnDecision = {
    speakerId: decision.speakerId,
    intent,
    turnFocus,
    action: eligibility.mustClose ? "close" : "next",
  };
  if (targetMessageId) sanitized.targetMessageId = targetMessageId;
  if (references && references.length > 0) sanitized.references = [...new Set(references)];
  if (decision.reasonCode) sanitized.reasonCode = decision.reasonCode;

  return { decision: sanitized, repaired: issues.length > 0, issues };
}

function lastOtherMessage(snapshot: DiscussionSnapshot, speakerId: string) {
  for (let i = snapshot.messages.length - 1; i >= 0; i -= 1) {
    const message = snapshot.messages[i];
    if (message.expertId !== speakerId) return message;
  }
  return undefined;
}

function twoSpeakerReferences(snapshot: DiscussionSnapshot): string[] | undefined {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (let i = snapshot.messages.length - 1; i >= 0; i -= 1) {
    const message = snapshot.messages[i];
    if (seen.has(message.expertId)) continue;
    seen.add(message.expertId);
    refs.push(message.id);
    if (refs.length === 2) return refs;
  }
  return undefined;
}

function fallbackFocus(stanceAxis: string | undefined, snapshot: DiscussionSnapshot): string {
  const axis = stanceAxis?.trim();
  if (axis && axis.length >= 2 && axis.length <= 20) return axis;
  const topic = snapshot.topic.trim();
  if (topic.length >= 2 && topic.length <= 20) return topic;
  return "本轮的判断依据";
}
