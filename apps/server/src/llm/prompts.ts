/**
 * Prompt facade — everything comes from `@ai-panel/agent` (AI/Agent owner).
 *
 * The server never contains prompt text (SOP §11). Call sites import builders
 * from this module only, so a future prompt-version bump is a one-file change.
 */
export {
  buildRosterPrompt,
  buildDecisionPrompt,
  buildSpeechPrompt,
  buildInsightPrompt,
  buildSummaryPrompt,
  PROMPT_VERSIONS,
} from "@ai-panel/agent";

/** Version stamped into logs (never into event payloads, per AGENT-API §2). */
export const PROMPT_VERSION = "1.0.0";
