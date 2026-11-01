import type { ExpertPersona } from "@ai-panel/agent";
import { normalizeRoster, parseRosterOutput } from "@ai-panel/agent";
import type { CoreDeps } from "../context";
import { AppError } from "../http/errors";
import { buildRosterPrompt } from "../llm/prompts";
import { LlmError, type MockScenario } from "../llm/types";
import { prefixedId } from "../lib/ids";
import type { ExpertInput } from "../repositories/experts.repo";

export interface GeneratedRoster {
  experts: ExpertInput[];
  degraded: boolean;
  warnings: string[];
}

export interface RosterService {
  generate(input: {
    discussionId: string;
    topic: string;
    expertCount: number;
    scenario: MockScenario;
    avoidNames?: string[];
  }): Promise<GeneratedRoster>;
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof LlmError) {
    switch (error.kind) {
      case "timeout":
      case "aborted":
        return new AppError("LLM_TIMEOUT", "模型响应超时，请重试");
      case "auth":
        return new AppError("LLM_NOT_CONFIGURED", "模型鉴权失败，请检查服务端配置");
      case "empty_output":
      case "invalid_output":
        return new AppError("LLM_INVALID_OUTPUT", "模型输出无法解析，请重试");
      default:
        // Keep the upstream HTTP status: during the first `real` smoke this is what
        // tells us whether the provider rejected a request field (400) or the
        // network/route failed. No Key, prompt or stack ever goes into details.
        return new AppError("ROSTER_GENERATION_FAILED", "阵容生成失败，请重试", {
          ...(error.status ? { upstreamStatus: error.status } : {}),
        });
    }
  }
  return new AppError("ROSTER_GENERATION_FAILED", "阵容生成失败，请重试");
}

/**
 * DB ids must be globally unique, but agent personas use readable local ids
 * (`e_host`, `e_1`). We keep the agent ids as display order only and mint fresh
 * server ids so two discussions can never collide on a PRIMARY KEY.
 */
function toExpertInput(persona: ExpertPersona, sortOrder: number): ExpertInput {
  return {
    id: prefixedId("e"),
    role: persona.role,
    name: persona.name,
    profession: persona.profession,
    title: persona.title,
    stance: persona.stance,
    stanceAxis: persona.stanceAxis,
    polarity: persona.polarity,
    focusArea: persona.focusArea,
    color: persona.color,
    sortOrder,
  };
}

export function createRosterService(deps: CoreDeps): RosterService {
  async function callOnce(
    input: {
      discussionId: string;
      topic: string;
      expertCount: number;
      scenario: MockScenario;
      avoidNames?: string[];
    },
    attempt: number,
  ) {
    const prompt = buildRosterPrompt({
      topic: input.topic,
      expertCount: input.expertCount,
      ...(input.avoidNames && input.avoidNames.length > 0
        ? { avoidNames: input.avoidNames }
        : {}),
    });
    return deps.llm.json({
      prompt,
      signal: AbortSignal.timeout(deps.config.llm.timeouts.roster),
      timeoutMs: prompt.timeoutMs ?? deps.config.llm.timeouts.roster,
      parse: parseRosterOutput,
      meta: {
        discussionId: input.discussionId,
        scenario: input.scenario,
        turnIndex: attempt,
        expertCount: input.expertCount,
        roster: [],
      },
    });
  }

  return {
    async generate(input): Promise<GeneratedRoster> {
      const startedAt = Date.now();
      try {
        const result = await callOnce(input, 0);
        let normalized = normalizeRoster(result.value, {
          expertCount: input.expertCount,
          avoidNames: input.avoidNames,
        });

        // AGENT-API §5.1: retry once when the roster is semantically broken, but
        // only if it still fits the latency budget (NRF-01 p95 < 12s).
        if (normalized.needsRetry) {
          const elapsed = Date.now() - startedAt;
          const budget = deps.config.llm.timeouts.roster;
          if (elapsed < budget / 2) {
            const retry = await callOnce(input, 1);
            const second = normalizeRoster(retry.value, {
              expertCount: input.expertCount,
              avoidNames: input.avoidNames,
            });
            if (!second.needsRetry) normalized = second;
          }
        }

        const experts: ExpertInput[] = [
          ...normalized.experts.map((persona, index) => toExpertInput(persona, index + 1)),
          toExpertInput(normalized.host, 0),
        ].sort((a, b) => a.sortOrder - b.sortOrder);

        if (experts.length !== input.expertCount + 1) {
          throw new AppError("ROSTER_GENERATION_FAILED", "阵容人数不符合要求，请重试");
        }

        return {
          experts,
          degraded: normalized.degraded || normalized.repaired,
          warnings: normalized.warnings,
        };
      } catch (error) {
        throw toAppError(error);
      }
    },
  };
}
