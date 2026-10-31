import type { DiscussionStatus, Expert, Insight, InsightType } from "../api/types";
import type { SessionView } from "./session";

export type ExpertStatus = "idle" | "preparing" | "speaking";

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

/**
 * idle / preparing / speaking, derived purely from the projection plus one
 * boolean from the stream buffer ("has this message produced any text yet?").
 * Never a timer-driven fake state.
 */
export function deriveExpertStatus(
  view: SessionView,
  expertId: string,
  streamingMessageId: string | null,
  streamingHasText: boolean,
): ExpertStatus {
  const active = view.activeTurn;
  if (!active || active.speakerId !== expertId) return "idle";
  if (streamingMessageId && streamingMessageId === active.messageId) {
    return streamingHasText ? "speaking" : "preparing";
  }
  return streamingHasText ? "speaking" : "preparing";
}

export interface Progress {
  value: number;
  max: number;
  ratio: number;
  label: string;
  /** True when the server never told us the denominator. */
  indeterminate: boolean;
}

export function progressOf(view: SessionView): Progress {
  const max = view.plannedTurns > 0 ? view.plannedTurns : 0;
  const value = view.turnCount;
  if (max === 0) {
    return {
      value,
      max: 0,
      ratio: 0,
      label: `已进行 ${value} 轮`,
      indeterminate: true,
    };
  }
  return {
    value,
    max,
    ratio: Math.min(1, value / max),
    label: `${value} / ${max} 轮`,
    indeterminate: false,
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
