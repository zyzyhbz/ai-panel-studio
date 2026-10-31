/**
 * 契约 v1.0 的类型镜像（来源：docs/06-G1契约决议.md + packages/shared/src/index.ts）。
 *
 * 说明：这里刻意**不 import `@ai-panel/shared`**。
 * 1) E2E 是独立进程，不想因为 workspace 包的构建产物缺失而跑不起来；
 * 2) 测试需要"对契约的独立表述"，直接复用实现类型会让"契约被改坏"这件事也一起通过编译。
 * 3) 两份定义是否一致，由 specs/contract.shared-parity.spec.ts 这类用例守住。
 */

export type DiscussionStatus =
  | "generating"
  | "ready"
  | "live"
  | "summarizing"
  | "ended"
  | "failed";

export type Intent =
  | "opening"
  | "probe"
  | "rebut"
  | "support"
  | "extend"
  | "clarify"
  | "mediate"
  | "redirect"
  | "summary";

export type Polarity =
  | "strong_oppose"
  | "oppose"
  | "neutral"
  | "support"
  | "strong_support";

export type InsightType = "consensus" | "divergence" | "open_question";

export type TurnAbortReason =
  | "user_end"
  | "llm_timeout"
  | "invalid_output"
  | "empty_output"
  | "guard_rejected"
  | "interrupted"
  | "watchdog";

export type QaScenario =
  | "normal"
  | "slow"
  | "timeout"
  | "invalid-json"
  | "empty"
  | "duplicate"
  | "runaway"
  | "long"
  | "mixed";

export type LlmTaskKind = "roster" | "decision" | "speech" | "consensus" | "summary";

export interface Expert {
  id: string;
  role: "host" | "expert";
  name: string;
  profession: string;
  title: string;
  stance: string;
  stanceAxis: string;
  polarity: Polarity;
  color: string;
  focusArea: string;
  sortOrder: number;
}

export interface Message {
  id: string;
  expertId: string;
  speakerName: string;
  speakerTitle: string;
  speakerColor: string;
  content: string;
  intent: Intent;
  turnIndex: number;
  charCount: number;
  degraded: boolean;
  targetMessageId?: string;
  references?: string[];
  createdAt: string;
}

export interface Insight {
  id: string;
  type: InsightType;
  content: string;
  evidenceMessageIds: string[];
  firstSeenTurn: number;
  updatedAt: string;
}

export interface DiscussionSummary {
  content: string;
  isFallback: boolean;
  createdAt: string;
}

export interface ActiveTurn {
  turnIndex: number;
  speakerId: string;
  messageId: string;
  intent: Intent;
  turnFocus: string;
  references: string[];
}

export interface DiscussionListItem {
  id: string;
  topic: string;
  status: DiscussionStatus;
  expertCount: number;
  turnCount: number;
  plannedTurns: number;
  hostName: string;
  experts: Expert[];
  summaryPreview: string | null;
  errorCode: string | null;
  updatedAt: string;
  lastSeq: number;
}

export interface DiscussionDetail {
  discussion: {
    id: string;
    topic: string;
    status: DiscussionStatus;
    expertCount: number;
    turnCount: number;
    plannedTurns: number;
    lastSeq: number;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    endedAt: string | null;
    errorCode?: string | null;
  };
  experts: Expert[];
  messages: Message[];
  insights: Insight[];
  summary: DiscussionSummary | null;
  activeTurn: ActiveTurn | null;
  lastSeq: number;
}

/** GET /api/discussions/:id/state —— 事件重放投影（06 §1.8）。 */
export interface DiscussionState {
  discussionId: string;
  status: DiscussionStatus;
  turnCount: number;
  lastSeq: number;
  experts: Expert[];
  messages: Message[];
  insights: Insight[];
  summary: DiscussionSummary | null;
  activeTurn: ActiveTurn | null;
}

export interface HealthResponse {
  status: string;
  version: string;
  llmMode: string;
  dbReady: boolean;
  activeSseCount: number;
  uptimeMs: number;
  rssBytes: number;
  now: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: Record<string, unknown>;
  };
}

export interface PersistedEvent<T = unknown> {
  id: string;
  seq: number;
  type: string;
  payload: T;
  createdAt: string;
}

export interface EventPage {
  items: PersistedEvent[];
  lastSeq: number;
  hasMore: boolean;
}

/* ------------------------------------------------------------------ */
/* Mock LLM fixture（QA-PLAN §6.3，06 §1.9 场景名）                    */
/* ------------------------------------------------------------------ */

export interface LlmCallStep {
  /** 该步产出：模型"原始文本"。坏 JSON / 空串 / 超长文都是合法取值。 */
  content: string;
  meta?: {
    model?: string;
    thinking?: "enabled" | "disabled";
    finishReason?: "stop" | "length" | "content_filter";
    usage?: { promptTokens: number; completionTokens: number };
    /** 期望下游把它标成 degraded（兜底/截断/修复产物）。 */
    expectDegraded?: boolean;
  };
  timing?: {
    firstTokenDelayMs?: number;
    interDeltaMs?: number;
    /** true = 永不返回，用于超时用例。 */
    hang?: boolean;
    /** 抛出指定错误，模拟网络/限流。 */
    failWith?: "timeout" | "rate_limit" | "server_error" | "invalid_json";
  };
}

export type FixtureOutcome =
  | "ok"
  | "retry_then_ok"
  | "degraded"
  | "abort_turn"
  | "fail_session";

export interface LlmFixture {
  $schema: "qa/llm-fixture@1";
  name: string;
  kind: LlmTaskKind;
  scenario: QaScenario;
  /** 是否属于负例资产（坏数据）。用于覆盖度自检。 */
  negative: boolean;
  description: string;
  expectOutcome: FixtureOutcome;
  /** 期望被下游丢弃/降级的字段，供用例断言。 */
  expectNotes: string[];
  onExhausted: "loop" | "last" | "fail";
  steps: LlmCallStep[];
}

export interface TopicFixture {
  id: string;
  topic: string;
  expertCount: number;
  /** 期望的规划轮次（plannedTurns = clamp(4 + 2*expertCount, 8, 12)）。 */
  plannedTurns: number;
  maxTurns: number;
  /** 该议题对应的正常 roster fixture（相对 fixtures/llm/）。 */
  rosterFixture: string;
  /** 该议题的"独特词"，用于多会话串线检测。 */
  marker: string;
}

export interface TopicsFile {
  $schema: "qa/topics@1";
  topics: TopicFixture[];
}
