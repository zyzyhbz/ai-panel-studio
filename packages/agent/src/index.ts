import type { Intent, InsightType, Polarity } from "@ai-panel/shared";

/**
 * Agent package boundary:
 * - prompt builders, context assembly, output schemas, policy, mock client
 * - no direct filesystem/network/key access
 * - real DeepSeek transport is injected by apps/server
 */

export interface ExpertPersona {
  id: string;
  name: string;
  profession: string;
  title: string;
  stance: string;
  stanceAxis: string;
  polarity: Polarity;
  focusArea: string;
  color: string;
}

export interface TurnDecision {
  speakerId: string;
  intent: Intent;
  turnFocus: string;
  targetMessageId?: string;
  references?: string[];
}

export interface InsightDraft {
  type: InsightType;
  content: string;
  evidenceMessageIds: string[];
}

export const AGENT_PACKAGE_VERSION = "0.1.0";
