import {
  buildFallbackSummary as buildAgentFallbackSummary,
  parseSummaryText,
} from "@ai-panel/agent";
import type { CoreDeps } from "../context";
import { buildSummaryPrompt } from "../llm/prompts";
import type { MockScenario } from "../llm/types";
import { projectSnapshot } from "../session/project";

export interface GeneratedSummary {
  content: string;
  isFallback: boolean;
}

export interface SummaryService {
  ensure(discussionId: string, scenario?: MockScenario): Promise<GeneratedSummary | null>;
}

const MAX_SUMMARY_CHARS = 1_200;

/**
 * Host's closing summary. Primary path is the agent's P-SUMMARY prompt + parser;
 * fallback is the agent's template summary (reorders existing insights only, so it
 * never introduces new claims — PRD AR-08 / FR-10).
 */
export function createSummaryService(deps: CoreDeps): SummaryService {
  return {
    async ensure(discussionId, scenario: MockScenario = "normal"): Promise<GeneratedSummary | null> {
      const discussion = deps.repos.discussions.getById(discussionId);
      if (!discussion) return null;
      const existing = deps.repos.summaries.get(discussionId);
      if (existing) return { content: existing.content, isFallback: existing.isFallback };

      const snapshot = projectSnapshot(deps.repos, discussionId);
      if (!snapshot || snapshot.messages.length === 0) return null;

      const fallback = (): GeneratedSummary => ({
        content: buildAgentFallbackSummary(snapshot),
        isFallback: true,
      });

      const timeoutMs = deps.config.llm.timeouts.summary;
      const prompt = buildSummaryPrompt({
        snapshot,
        closingLine: snapshot.messages.at(-1)?.content ?? "",
      });

      try {
        let buffer = "";
        const stream = deps.llm.stream({
          prompt,
          signal: AbortSignal.timeout(timeoutMs),
          firstTokenTimeoutMs: Math.min(deps.config.llm.firstTokenTimeoutMs, timeoutMs),
          totalTimeoutMs: timeoutMs,
          meta: {
            discussionId,
            scenario,
            turnIndex: snapshot.turnCount,
            expertCount: snapshot.expertCount,
            roster: snapshot.experts.map((e) => ({ id: e.id, role: e.role, name: e.name })),
            topic: snapshot.topic,
            insights: snapshot.insights.map((i) => ({ id: i.id, type: i.type, content: i.content })),
            messageIds: snapshot.messages.slice(-20).map((m) => m.id),
          },
        });
        for await (const delta of stream) buffer += delta;

        const check = parseSummaryText(buffer);
        const content = [...check.content].slice(0, MAX_SUMMARY_CHARS).join("");
        if (content.length < 20) return fallback();
        return { content, isFallback: false };
      } catch (error) {
        deps.log.warn(
          { discussionId, err: (error as Error).message },
          "summary generation failed; using template summary",
        );
        return fallback();
      }
    },
  };
}
