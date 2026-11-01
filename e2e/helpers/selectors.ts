/**
 * DOM 选择器层：兼容两套 testid 约定。
 *
 * 背景：G1 未收敛的分歧（已作为缺陷上报）
 * - FE 计划 §13 落地为**内插式**：`message-{id}`、`expert-card-{id}`、`insight-{type}-{id}`、`roster-expert-{id}`；
 * - QA 计划 §5.2 建议**静态 testid + data-***（便于批量取、便于断言顺序/去重）。
 *
 * 现状（2026-11-01 实读代码）：前端按 §13 内插式实现，且几乎没有 `data-*` 语义属性。
 * 因此这里以"内插式为主、静态为辅"的并集选择器工作；`data-*` 有则优先（将来收敛不用改测试）。
 */

const SYM = Symbol("selector");

export type Selector = string & { readonly [SYM]?: true };

function one(...ids: string[]): Selector {
  return ids.map((id) => `[data-testid="${id}"]`).join(", ") as Selector;
}

function prefix(...prefixes: string[]): Selector {
  return prefixes.map((p) => `[data-testid^="${p}"]`).join(", ") as Selector;
}

function union(...parts: Array<string | null | undefined>): Selector {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(", ") as Selector;
}

export const SEL = {
  /* 壳与导航 */
  appShell: union(one("app-shell", "app"), "#root > *"),
  navHome: union(one("nav-home", "brand"), 'a[href="/"]'),

  /* 首页 */
  homeList: union(one("home-list", "discussion-list", "lobby")),
  homeEmpty: union(one("home-empty", "empty-state")),
  homeError: union(one("home-error", "error-state")),
  discCard: union(
    one("disc-card", "discussion-card"),
    prefix("disc-card-", "discussion-card-"),
    "article[data-discussion-id]",
    "[data-discussion-id]",
  ),
  discCardSummary: union(one("disc-card-summary", "card-summary")),
  discCardProgress: union(one("disc-card-progress")),
  newDiscussion: union(
    one("create-discussion", "new-discussion"),
    'a[href="/new"]',
    'button[data-action="new"]',
    // 空态 CTA（HomePage 的 EmptyState action 未挂 testid，用可访问名兜底）
    'button:has-text("发起")',
  ),

  /* 创建（实际：topic-input / expert-count-N / submit-create / topic-counter） */
  createForm: union(one("create-form"), "form"),
  createTopic: union(
    one("create-topic", "topic-input"),
    'textarea[name="topic"]',
    'input[name="topic"]',
    "#topic",
  ),
  createExpertCount: union(
    one("create-expert-count", "expert-count"),
    prefix("expert-count-"),
    'input[name="expertCount"]',
    'select[name="expertCount"]',
    '[role="radiogroup"][aria-label*="专家"]',
  ),
  createSubmit: union(one("create-submit", "submit-create"), 'button[type="submit"]'),
  createError: union(one("create-error", "form-error"), '[role="alert"]', '[aria-invalid="true"]'),
  createTopicCounter: union(one("topic-counter")),
  createGenerating: union(one("create-generating", "generating")),

  /* 阵容（实际：roster-expert-{id} / confirm-roster / regenerate-roster） */
  rosterPanel: union(one("roster-panel", "lobby"), prefix("roster-expert-")),
  rosterMember: union(one("roster-member"), prefix("roster-member-", "roster-expert-"), "[data-expert-id]"),
  rosterConfirm: union(one("roster-confirm", "confirm-roster"), 'button[data-action="confirm"]'),
  rosterRegenerate: union(one("roster-regenerate", "regenerate-roster"), 'button[data-action="regenerate"]'),

  /* 直播（实际：stage-header / expert-rail / transcript / summary-card / end-discussion） */
  stage: union(one("stage", "stage-header"), prefix("stage-")),
  stageStatus: union(one("stage-status", "status-pill"), "[data-status]"),
  stageConnState: union(one("stage-conn-state", "reconnect-banner"), "[data-conn-state]"),
  stageTurnCount: union(one("stage-turn-count"), "[data-turn-count]"),
  panel: union(one("panel"), "[data-panel]"),
  /** 演播厅三栏布局容器（StageView 里的 .studio-rail / .studio-stage / .studio-insights）。 */
  studioRail: union('[data-panel="rail"]', ".studio-rail", one("expert-rail")),
  studioStage: union('[data-panel="stage"]', ".studio-stage", one("transcript")),
  studioInsights: union('[data-panel="insights"]', ".studio-insights"),
  expertRail: union(one("expert-rail")),
  expertCard: union(one("expert-card"), prefix("expert-card-"), "[data-expert-id]"),
  transcriptList: union(one("transcript-list", "transcript"), '[role="log"]'),
  transcriptItem: union(one("transcript-item", "message"), prefix("message-")),
  streamingBubble: union(one("streaming-bubble")),
  turnNotice: union(one("turn-notice")),
  insightSection: union(one("insight-section"), "[data-type]"),
  insightItem: union(
    one("insight-item"),
    prefix("insight-consensus-", "insight-divergence-", "insight-open_question-"),
    "[data-insight-id]",
  ),
  insightToggle: union(one("insight-toggle")),
  summaryPanel: union(one("summary-panel", "summary", "summary-card")),
  summaryContent: union(one("summary-content", "summary-card")),
  jumpToLatest: union(one("jump-to-latest")),
  endDiscussion: union(one("end-discussion"), 'button[data-action="end"]'),
  confirmDialog: union(one("confirm-dialog")),
  confirmDialogAccept: union(one("confirm-dialog-accept")),

  /* 回放（实际：playback-bar / replay-toggle / replay-slider / replay-speed-N） */
  replayControls: union(one("replay-controls", "playback-bar"), prefix("replay-")),
  replayPlay: union(one("replay-play", "replay-toggle"), 'button[data-action="play"], button[data-action="pause"]'),
  replaySpeed: union(one("replay-speed"), prefix("replay-speed-")),
  replaySeek: union(one("replay-seek", "replay-slider"), 'input[type="range"]'),

  /* 通用 */
  toast: union(one("toast"), '[role="status"]'),
  errorBanner: union(one("error-banner", "error-state"), '[role="alert"]'),
  emptyState: union(one("empty-state"), prefix("empty-")),
  mobileTabs: union(one("mobile-tabs"), '[role="tablist"]'),
} as const;

/** 判断某个 testid 是否属于某类条目（用于 report 里判断前端用了哪套约定）。 */
export function detectConvention(testids: string[]): "static-data" | "interpolated" | "unknown" | "mixed" {
  const interpolated = testids.filter((t) => /^message-.+/.test(t) || /^expert-card-.+/.test(t)).length;
  const isStatic = testids.includes("transcript-item") || testids.includes("expert-card");
  if (interpolated > 0 && isStatic) return "mixed";
  if (interpolated > 0) return "interpolated";
  if (isStatic) return "static-data";
  return "unknown";
}

export function byTestId(id: string): Selector {
  return one(id);
}
