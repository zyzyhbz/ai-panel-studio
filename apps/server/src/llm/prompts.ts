/**
 * Prompt facade.
 *
 * Today this re-exports the local shim. When AI-02 publishes
 * `packages/agent` prompt builders, only this file changes.
 */
export {
  buildRosterPrompt,
  buildDecisionPrompt,
  buildSpeechPrompt,
  buildInsightPrompt,
  buildSummaryPrompt,
  type PromptSpecLike,
} from "./prompts.shim";

export const PROMPT_VERSION = "shim-0.1.0";
