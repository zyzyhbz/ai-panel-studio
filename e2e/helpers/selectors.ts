/**
 * DOM 选择器层：同时兼容两套 testid 约定。
 *
 * 背景（G1 未收敛的分歧，已作为缺陷上报）：
 * - FE 计划 §13：`message-{messageId}`、`expert-card-{expertId}`、`insight-{type}-{insightId}`（内插式）
 * - QA 计划 §5.2：`transcript-item` + `data-message-id` 等（静态 testid + 语义 data 属性）
 *
 * 本文件用"并集选择器 + 属性优先、testid 回退"的方式兼容两者，
 * 因此前端无论先落地哪一套，E2E 都能跑；等 PM 拍板后再收敛为单选。
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
  newDiscussion: union(one("create-discussion", "new-discussion"), 'a[href="/new"]', 'button[data-action="new"]'),

  /* 创建 */
  createForm: union(one("create-form")),
  createTopic: union(
    one("create-topic", "topic-input"),
    'textarea[name="topic"]',
    'input[name="topic"]',
    "#topic",
  ),
  createExpertCount: union(
    one("create-expert-count", "expert-count"),
    'input[name="expertCount"]',
    'select[name="expertCount"]',
    '[role="radiogroup"][aria-label*="专家"]',
  ),
  createSubmit: union(one("create-submit"), 'button[type="submit"]', 'form button:not([type="button"])'),
  createError: union(one("create-error", "form-error"), '[role="alert"]', '[aria-invalid="true"]'),
  createGenerating: union(one("create-generating", "generating")),

  /* 阵容 */
  rosterPanel: union(one("roster-panel", "lobby")),
  rosterMember: union(one("roster-member"), prefix("roster-member-"), "[data-expert-id]"),
  rosterConfirm: union(one("roster-confirm", "confirm-roster"), 'button[data-action="confirm"]'),
  rosterRegenerate: union(one("roster-regenerate"), 'button[data-action="regenerate"]'),

  /* 直播 */
  stage: union(one("stage"), prefix("stage-")),
  stageStatus: union(one("stage-status", "status-pill"), "[data-status]"),
  stageConnState: union(one("stage-conn-state", "reconnect-banner"), "[data-conn-state]"),
  stageTurnCount: union(one("stage-turn-count"), "[data-turn-count]"),
  panel: union(one("panel"), "[data-panel]"),
  expertCard: union(one("expert-card"), prefix("expert-card-"), "[data-expert-id]"),
  transcriptList: union(one("transcript-list", "transcript"), '[role="log"]'),
  transcriptItem: union(one("transcript-item", "message"), prefix("message-")),
  insightSection: union(one("insight-section"), "[data-type]"),
  insightItem: union(
    one("insight-item"),
    prefix("insight-consensus-", "insight-divergence-", "insight-open_question-"),
    "[data-insight-id]",
  ),
  summaryPanel: union(one("summary-panel", "summary")),
  summaryContent: union(one("summary-content")),
  jumpToLatest: union(one("jump-to-latest")),
  endDiscussion: union(one("end-discussion"), 'button[data-action="end"]'),

  /* 回放 */
  replayControls: union(one("replay-controls"), prefix("replay-")),
  replayPlay: union(one("replay-play"), 'button[data-action="play"], button[data-action="pause"]'),
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
