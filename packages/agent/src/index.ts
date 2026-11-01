/**
 * `@ai-panel/agent` 公共 API。
 *
 * 包边界（G1 决议 §1.11）：
 * - 本包负责：prompt、上下文组装、输出 schema/解析、行为策略、mock client、fixtures
 * - 不负责：HTTP、SSE、DB、队列、Key；真实 DeepSeek transport 由 `apps/server/src/llm` 注入
 *
 * 后端最小集成顺序见 `docs/AGENT-API.md`：
 *   buildEligibility → buildXxxPrompt → client.json()/stream() → parseXxxOutput → sanitize/normalize
 */

export const AGENT_PACKAGE_VERSION = "0.2.0";

/* ------------------------------------------------------------------ */
/* LLM 传输契约（backend 实现 transport，本包提供 mock）               */
/* ------------------------------------------------------------------ */

export {
  DEFAULT_LLM_PARAMS,
  DEFAULT_TIMEOUTS,
  LlmError,
  MOCK_SCENARIOS,
  PROMPT_ID_TO_KIND,
  PROMPT_IDS,
  PROMPT_KINDS,
  SPEECH_FIRST_TOKEN_TIMEOUT_MS,
  type LLMClient,
  type LlmErrorKind,
  type LlmJsonRequest,
  type LlmJsonResult,
  type LlmMockMeta,
  type LlmStreamRequest,
  type LlmStreamResult,
  type LlmUsage,
  type MockScenario,
  type PromptId,
  type PromptKind,
  type PromptSpec,
} from "./llm/types";

/* ------------------------------------------------------------------ */
/* 领域类型                                                            */
/* ------------------------------------------------------------------ */

export {
  COLOR_KEYS,
  COLOR_PALETTE,
  HOST_COLOR,
  REASON_CODES,
  type CloseReason,
  type ColorKey,
  type DiscussionSnapshot,
  type ExpertPersona,
  type InsightItem,
  type PersonaDraft,
  type PublicTurn,
  type ReasonCode,
  type RosterDraft,
  type RosterResult,
  type TranscriptMessage,
  type TurnDecision,
  type TurnPhase,
} from "./core/types";

/** 兼容旧导出名（G2 早期占位） */
export type InsightDraft = {
  type: import("@ai-panel/shared").InsightType;
  content: string;
  evidenceMessageIds: string[];
};

/* ------------------------------------------------------------------ */
/* Prompt builders（五类）                                             */
/* ------------------------------------------------------------------ */

export { buildRosterPrompt, paletteSummary, type RosterPromptInput } from "./prompts/roster";
export { buildDecisionPrompt, type DecisionPromptInput } from "./prompts/decision";
export { buildSpeechPrompt, type SpeechPromptInput } from "./prompts/speech";
export { buildInsightPrompt, type InsightPromptInput } from "./prompts/insight";
export { buildSummaryPrompt, type SummaryPromptInput } from "./prompts/summary";
export { PROMPT_VERSIONS, SHARED_RULES, bulletList, makeSpec, repairBlock } from "./prompts/common";

/* ------------------------------------------------------------------ */
/* 上下文组装                                                          */
/* ------------------------------------------------------------------ */

export {
  CONTEXT_BUDGET,
  DIGEST_WINDOW,
  FULL_WINDOW,
  assembleContext,
  buildDigest,
  intentLabel,
  messageLine,
  personaLine,
  phaseFor,
  phaseLabel,
  planFor,
  planText,
  polarityLabel,
  renderContextBlock,
  renderInsights,
  type AssembleOptions,
  type ContextBundle,
  type ContextPurpose,
  type TurnPlan,
} from "./context/assemble";

/* 轮次与收敛常量（以观点饱和为准，轮数只是保底） */
export { MAX_TURNS, MIN_EXPERT_SPEAKS, STALE_WINDOW, coverageFloorFor } from "./core/rounds";

/* 争论结构（debateMap）：确定性投影，不调 LLM */
export {
  MAX_PREMISES,
  MAX_TENSIONS,
  MAX_UNANSWERED,
  buildDebateMap,
  challengeTargets,
  isEmptyDebateMap,
  isLikelyNovel,
  renderDebateMap,
  renderSaturation,
  type DebateClaim,
  type DebateMap,
  type Saturation,
  type UnansweredChallenge,
} from "./context/debate-map";

/* ------------------------------------------------------------------ */
/* 输出 schema 与解析                                                  */
/* ------------------------------------------------------------------ */

export {
  decisionOutputSchema,
  insightItemOutputSchema,
  insightOutputSchema,
  rosterOutputSchema,
  rosterPersonaSchema,
  summaryOutputSchema,
  type DecisionOutput,
  type InsightItemOutput,
  type InsightOutput,
  type RosterOutput,
  type RosterPersonaOutput,
  type SummaryOutput,
} from "./schema";

export { AgentParseError, parseDecisionOutput, parseInsightOutput, parseRosterOutput, parseSummaryText } from "./parse/output";
export { extractJsonObject, parseJsonWithSchema, type JsonParseResult } from "./parse/json";

/* 文本工具（eval / QA 统计指标时复用，避免各处重写） */
export {
  char3GramJaccard,
  countSentences,
  estimateTokens,
  extractNumbers,
  hash32,
  normalizeWhitespace,
  splitSentences as splitSentencesText,
  stripFormatting,
  truncateChars,
} from "./core/text";

/* ------------------------------------------------------------------ */
/* 行为策略（guard / fallback / normalize）                            */
/* ------------------------------------------------------------------ */

export {
  CONSECUTIVE_HARD_LIMIT,
  EXPERT_CAP_EXTRA,
  HOST_TURN_MIN,
  HOST_TURN_MAX,
  hostTurnLimit,
  buildEligibility,
  closingIntent,
  consecutiveTail,
  evaluateClose,
  hostQuotaOf,
  preferredIntents,
  type AllowedSpeaker,
  type Eligibility,
  type ForcedReason,
  type HostQuota,
} from "./policy/eligibility";

export { sanitizeDecision, validateDecision, validateTurnFocus, type DecisionIssue, type DecisionIssueCode, type DecisionValidation, type SanitizeResult } from "./policy/decision";
export { inferIntent, selectFallbackSpeaker, type FallbackChoice, type FallbackOptions } from "./policy/fallback";
export { HOST_MAX_CHARS, MAX_SENTENCES, REPETITION_THRESHOLD, SPEECH_MAX_CHARS, SPEECH_TARGET_CHARS, normalizeSpeech, splitSentences, validateSpeech, type SpeechCheck, type SpeechCheckOptions } from "./policy/speech";
export { DUPLICATE_SIMILARITY, INSIGHT_CAPS, INSIGHT_MAX_CHARS, MAX_NEW_INSIGHTS, insightsForSummary, normalizeInsights, summarizeInsightRejections, type InsightNormalizeOptions, type InsightNormalizeResult, type RejectedInsight } from "./policy/insight";
export { FORBIDDEN_NAMES, POLARITY_LABEL, TEMPLATE_EXPERTS, checkDiversity, normalizeRoster, type NormalizeRosterOptions } from "./policy/roster";
export { SUMMARY_MAX_CHARS, SUMMARY_MIN_CHARS, buildFallbackSummary, normalizeSummary, toSummaryOutput, type SummaryCheck } from "./policy/summary";

/* ------------------------------------------------------------------ */
/* Mock client 与 fixtures（eval / 测试用）                            */
/* ------------------------------------------------------------------ */

export { MockLLMClient, buildMockMeta, createMockClient, type MockCallRecord, type MockClientOptions } from "./llm/mock-client";
export { TOPIC_FIXTURES, FIXTURE_BY_ID, fixtureById, fixtureForExpertCount, fixtureRosterJson, type FixtureExpert, type TopicFixture } from "./llm/fixtures";
