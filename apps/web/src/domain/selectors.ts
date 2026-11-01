import type { DiscussionStatus, Expert, Insight, InsightType } from "../api/types";
import type { SessionView } from "./session";

/**
 * Five explicit agent states (docs/09 §4). Every seat renders the label, not
 * just a colour, so the state is readable with colour-blindness or on a
 * projector.
 */
export type ExpertStatus =
  | "idle"
  | "thinking"
  | "preparing"
  | "speaking"
  | "finished";

export const EXPERT_STATUS_LABEL: Record<ExpertStatus, string> = {
  idle: "待机",
  thinking: "思考中",
  preparing: "准备发言",
  speaking: "发言中",
  finished: "已结束",
};

/** After this long without a first token, "准备发言" becomes "思考中". */
export const PREPARING_WINDOW_MS = 1200;

/** docs/09 §5: hard safety cap, not a target. */
export const MAX_TURNS = 36;

/**
 * `plannedTurns` is a *coverage floor*: every expert speaks at least twice
 * (2n + 2, capped at 12). It is not a target and the UI must never render it
 * as "目标 N 轮" — the discussion ends when the arguments saturate, and
 * `MAX_TURNS = 36` is only a safety cap.
 */
export function coverageFloorFor(expertCount: number): number {
  const count = Math.min(6, Math.max(3, Math.trunc(expertCount) || 3));
  return Math.min(12, 2 * count + 2);
}

export interface InsightGroups {
  consensus: Insight[];
  divergence: Insight[];
  openQuestion: Insight[];
}

const EMPTY_GROUPS: InsightGroups = {
  consensus: [],
  divergence: [],
  openQuestion: [],
};

export function groupInsights(insights: Insight[]): InsightGroups {
  if (insights.length === 0) return EMPTY_GROUPS;
  const groups: InsightGroups = {
    consensus: [],
    divergence: [],
    openQuestion: [],
  };
  const bucket: Record<InsightType, Insight[]> = {
    consensus: groups.consensus,
    divergence: groups.divergence,
    open_question: groups.openQuestion,
  };
  for (const insight of insights) {
    bucket[insight.type]?.push(insight);
  }
  return groups;
}

export function hostOf(roster: Expert[]): Expert | null {
  return roster.find((e) => e.role === "host") ?? null;
}

export function expertsOf(roster: Expert[]): Expert[] {
  return roster
    .filter((e) => e.role === "expert")
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function speakerOf(roster: Expert[], expertId: string): Expert | null {
  return roster.find((e) => e.id === expertId) ?? null;
}

/* ---------------------------------------------------------------- *
 * Agent status
 * ---------------------------------------------------------------- */

export interface ExpertStatusInput {
  expertId: string;
  view: SessionView;
  streamingMessageId: string | null;
  streamingHasText: boolean;
  /** Ticking clock; without it the preparing→thinking split is skipped. */
  now?: number | null;
  /** In replay the message body is already applied, so treat it as speaking. */
  replayMode?: boolean;
}

export function deriveExpertStatus(input: ExpertStatusInput): ExpertStatus {
  const {
    expertId,
    view,
    streamingMessageId,
    streamingHasText,
    now,
    replayMode,
  } = input;

  if (view.status === "ended" || view.status === "failed") return "finished";

  const active = view.activeTurn;
  if (!active || active.speakerId !== expertId) return "idle";

  if (replayMode) {
    const applied = view.messages.some((m) => m.id === active.messageId);
    return applied ? "speaking" : "preparing";
  }

  if (streamingHasText && streamingMessageId === active.messageId) {
    return "speaking";
  }

  const startedAt = view.turnStartedAt
    ? Date.parse(view.turnStartedAt)
    : Number.NaN;
  if (now != null && Number.isFinite(startedAt)) {
    return now - startedAt > PREPARING_WINDOW_MS ? "thinking" : "preparing";
  }

  return "preparing";
}

export function deriveAllStatuses(
  view: SessionView,
  streamingMessageId: string | null,
  streamingHasText: boolean,
  now?: number | null,
  replayMode?: boolean,
): Map<string, ExpertStatus> {
  const map = new Map<string, ExpertStatus>();
  for (const expert of view.roster) {
    map.set(
      expert.id,
      deriveExpertStatus({
        expertId: expert.id,
        view,
        streamingMessageId,
        streamingHasText,
        now,
        replayMode,
      }),
    );
  }
  return map;
}

/* ---------------------------------------------------------------- *
 * Rounds — "x / 安全上限 36", never a target
 * ---------------------------------------------------------------- */

export interface Progress {
  value: number;
  /** Hard safety cap, used as the denominator. */
  max: number;
  ratio: number;
  label: string;
  indeterminate: boolean;
}

export function progressOf(view: SessionView): Progress {
  const max = view.maxTurns > 0 ? view.maxTurns : MAX_TURNS;
  const value = view.turnCount;
  return {
    value,
    max,
    ratio: max > 0 ? Math.min(1, value / max) : 0,
    label: `${value} / 安全上限 ${max}`,
    indeterminate: false,
  };
}

/* ---------------------------------------------------------------- *
 * Convergence — derived from real fields only, never invented
 * ---------------------------------------------------------------- */

export type ConvergencePhase = "observing" | "open" | "converging" | "closed";

export interface Convergence {
  phase: ConvergencePhase;
  /** Messages that were challenged and never answered by their speaker. */
  unanswered: number;
  /** Open questions currently recorded as insights. */
  openQuestions: number;
  /** Divergences still standing. */
  divergences: number;
  label: string;
  detail: string;
}

/**
 * Deterministic projection over `targetMessageId` + insights.
 *
 * "Unanswered challenge" = message B was targeted by a later message A, and
 * B's speaker has not spoken again since A. That is the same structure the
 * agent's `debateMap` builds, computed here from fields the contract already
 * returns — nothing is invented when the data is missing: with fewer than
 * three messages we say "观察中" and show no numbers.
 */
export function convergenceOf(view: SessionView): Convergence {
  const openQuestions = view.insights.filter(
    (i) => i.type === "open_question",
  ).length;
  const divergences = view.insights.filter((i) => i.type === "divergence").length;

  if (view.status === "ended") {
    return {
      phase: "closed",
      unanswered: 0,
      openQuestions,
      divergences,
      label: "讨论已收敛",
      detail: openQuestions > 0 ? `留下 ${openQuestions} 个未决问题` : "没有留下未决问题",
    };
  }

  if (view.status === "failed" || view.messages.length < 3) {
    return {
      phase: "observing",
      unanswered: 0,
      openQuestions,
      divergences,
      label: "观察中",
      detail: "争点尚未成形",
    };
  }

  const byId = new Map(view.messages.map((m) => [m.id, m]));
  const unansweredIds = new Set<string>();

  for (const challenger of view.messages) {
    const target = challenger.targetMessageId;
    if (!target) continue;
    const targetMessage = byId.get(target);
    if (!targetMessage) continue;

    const answered = view.messages.some(
      (m) =>
        m.expertId === targetMessage.expertId &&
        m.turnIndex > challenger.turnIndex,
    );
    if (!answered) unansweredIds.add(targetMessage.id);
  }

  const unanswered = unansweredIds.size;

  if (unanswered > 0) {
    return {
      phase: "open",
      unanswered,
      openQuestions,
      divergences,
      label: `仍有 ${unanswered} 个未回应挑战`,
      detail:
        openQuestions > 0 ? `${openQuestions} 个未决问题待验证` : "争点仍在推进",
    };
  }

  if (openQuestions > 0) {
    return {
      phase: "open",
      unanswered,
      openQuestions,
      divergences,
      label: `仍有 ${openQuestions} 个未决问题`,
      detail: "观点已交锋，结论待验证",
    };
  }

  return {
    phase: "converging",
    unanswered,
    openQuestions,
    divergences,
    label: "正在收敛",
    detail: "主要争点已被回应",
  };
}

export const STATUS_LABEL: Record<DiscussionStatus, string> = {
  generating: "生成中",
  ready: "待确认",
  live: "直播中",
  summarizing: "收尾中",
  ended: "已结束",
  failed: "已中断",
};

export const INTENT_LABEL: Record<string, string> = {
  opening: "开场",
  probe: "追问",
  rebut: "反驳",
  support: "支持",
  extend: "补充",
  clarify: "澄清",
  mediate: "串联",
  redirect: "引导",
  summary: "总结",
};

export const ABORT_LABEL: Record<string, string> = {
  user_end: "讨论已结束",
  llm_timeout: "这一轮模型超时了",
  invalid_output: "这一轮模型输出无法解析",
  empty_output: "这一轮模型没有给出内容",
  guard_rejected: "这一轮内容未通过校验",
  interrupted: "这一轮被中断了",
  watchdog: "这一轮耗时过长，已跳过",
};

export function abortLabel(reason: string): string {
  return ABORT_LABEL[reason] ?? "这一轮没有完成";
}

/** Collapse whitespace and hard-truncate on a code-point boundary. */
export function excerpt(text: string, max = 80): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(normalized);
  if (chars.length <= max) return normalized;
  return `${chars.slice(0, max).join("")}…`;
}
