import type { DiscussionStatus, ExpertRole, InsightType, Intent, Polarity } from "@ai-panel/shared";

/**
 * 领域输入/输出类型。
 *
 * 这些类型是 agent 包与 backend 之间的数据契约：
 * - backend 从 DB 投影出 `DiscussionSnapshot` 传给 agent；
 * - agent 返回 `TurnDecision` / `RosterResult` / `InsightSnapshot` 等纯数据；
 * - agent 不接触 DB、不接触事件持久化、不接触 SSE。
 */

/** 一位参会者（主持人也在这个结构里，通过 role 区分）。 */
export interface ExpertPersona {
  id: string;
  role: ExpertRole;
  name: string;
  profession: string;
  title: string;
  /** 一句人话立场，展示用 */
  stance: string;
  /** 机器判定的立场轴，如「岗位替代 vs 岗位重构」 */
  stanceAxis: string;
  polarity: Polarity;
  /** 静态关注领域（原 focus），非发言时刻展示 */
  focusArea: string;
  /** 十六进制色值，会话内唯一 */
  color: string;
}

/** 一条已完成的发言（只含公开字段）。 */
export interface TranscriptMessage {
  id: string;
  expertId: string;
  speakerName: string;
  turnIndex: number;
  intent: Intent;
  content: string;
  charCount: number;
  targetMessageId?: string;
  references?: string[];
  degraded?: boolean;
}

/** 当前共识/分歧/待验证快照条目。决策 v1.0 已删除 status 与 axis。 */
export interface InsightItem {
  id: string;
  type: InsightType;
  content: string;
  evidenceMessageIds: string[];
  firstSeenTurn: number;
}

/** backend 投影出的只读会话快照；agent 侧的所有纯函数都以它为唯一输入。 */
export interface DiscussionSnapshot {
  discussionId: string;
  topic: string;
  expertCount: number;
  status: DiscussionStatus;
  /** 已完成的发言数（含主持人），不含 aborted */
  turnCount: number;
  plannedTurns: number;
  maxTurns: number;
  /** 含主持人；host 也会出现在这里（role=host） */
  experts: ExpertPersona[];
  messages: TranscriptMessage[];
  insights: InsightItem[];
  summary?: string | null;
}

/* ------------------------------------------------------------------ */
/* 阵容                                                                */
/* ------------------------------------------------------------------ */

export const COLOR_KEYS = [
  "ocean",
  "cyan",
  "steel",
  "mist",
  "indigo",
  "bronze",
  "sand",
  "navy",
] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];

/**
 * 专家调色板：刻意避开四个语义色相
 * （共识绿、分歧红、待验证紫、强调金），避免颜色与状态混淆。
 */
export const COLOR_PALETTE: Record<ColorKey, { hex: string; label: string }> = {
  ocean: { hex: "#3E7CB1", label: "海蓝" },
  cyan: { hex: "#2F92B0", label: "青蓝" },
  steel: { hex: "#6E86B8", label: "钢蓝" },
  mist: { hex: "#8CA0B3", label: "雾蓝" },
  indigo: { hex: "#5A63A8", label: "靛蓝" },
  bronze: { hex: "#A9795A", label: "古铜" },
  sand: { hex: "#B99B6B", label: "沙金" },
  navy: { hex: "#34507A", label: "藏青" },
};

/** 主持人固定中性色，不占用专家调色板。 */
export const HOST_COLOR = "#D9D9D9";

/** 模型输出的阵容草稿（尚未分配 id；颜色二选一）。 */
export interface PersonaDraft {
  name: string;
  profession: string;
  title: string;
  stance: string;
  stanceAxis: string;
  polarity: Polarity;
  focusArea: string;
  /** 调色板 key（推荐）；与 color 二选一 */
  colorKey?: ColorKey;
  /** 兼容既有 fixtures 的十六进制色；与 colorKey 二选一 */
  color?: string;
}

export interface RosterDraft {
  host: PersonaDraft;
  experts: PersonaDraft[];
}

/** 校验后的阵容：颜色已解析成 hex，可带修复告警。 */
export interface RosterResult {
  host: ExpertPersona;
  experts: ExpertPersona[];
  /** 结构性问题（例如缺反对侧）与修复动作，便于 QA/日志观察 */
  warnings: string[];
  /** 是否做过合成修复（颜色/姓名） */
  repaired: boolean;
  /** 是否用过模板位补齐 */
  degraded: boolean;
  /** 语义层面无法局部修复（缺反对侧等），建议 backend 重试一次 */
  needsRetry: boolean;
}

/* ------------------------------------------------------------------ */
/* 单轮决策                                                            */
/* ------------------------------------------------------------------ */

/** 内部决策理由码：只进日志/eval，绝不进事件或 UI（防止变成 CoT）。 */
export const REASON_CODES = [
  "fresh_voice",
  "direct_clash",
  "fills_gap",
  "follow_up",
  "answer_challenge",
  "pressure_test",
  "closing",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export interface TurnDecision {
  speakerId: string;
  intent: Intent;
  /** 本轮争点/问题（对外字段 turnFocus），允许以 ？ 结尾 */
  turnFocus: string;
  targetMessageId?: string;
  references?: string[];
  action?: "next" | "close";
  reasonCode?: ReasonCode;
}

/** 供事件层使用的公开字段；decision 的 reasonCode 等内部字段在此被剥离。 */
export interface PublicTurn {
  turnIndex: number;
  speakerId: string;
  intent: Intent;
  turnFocus: string;
  targetMessageId?: string;
  references?: string[];
}

/**
 * 收尾原因（以观点饱和为准，轮数只是保底）：
 * - `saturated`：过了覆盖保底，且饱和条件全满足（最近没有新观点、没有阻塞挑战等）；
 * - `hard_cap`：到达安全上限 36，必须收，并在总结里列出未解决争点。
 */
export type CloseReason = "saturated" | "hard_cap";

export type TurnPhase = "open" | "expand" | "clash" | "deepen" | "preclose" | "close";
