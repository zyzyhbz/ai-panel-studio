import { normalizeInsights, parseInsightOutput } from "@ai-panel/agent";
import type { CoreDeps } from "../context";
import { toInsightDto } from "../http/serializers";
import { buildInsightPrompt } from "../llm/prompts";
import { LlmError, type MockScenario } from "../llm/types";
import { projectSnapshot } from "../session/project";

export interface InsightService {
  /** Coalescing trigger: at most one extraction in flight per session. */
  notify(discussionId: string, scenario?: MockScenario): void;
  /** Wait for pending work (bounded) before writing terminal events. */
  flush(discussionId: string, timeoutMs: number): Promise<void>;
  isBusy(discussionId: string): boolean;
}

interface SessionState {
  pending: boolean;
  scenario: MockScenario;
  running: Promise<void> | null;
}

export function createInsightService(deps: CoreDeps): InsightService {
  const states = new Map<string, SessionState>();

  function stateFor(discussionId: string): SessionState {
    let state = states.get(discussionId);
    if (!state) {
      state = { pending: false, scenario: "normal", running: null };
      states.set(discussionId, state);
    }
    return state;
  }

  async function extract(discussionId: string): Promise<void> {
    const snapshot = projectSnapshot(deps.repos, discussionId);
    if (!snapshot) return;
    if (snapshot.status === "ended" || snapshot.status === "failed") return;
    // First two turns are allowed to have no insights (AGENT-API §5.4).
    if (snapshot.messages.length === 0) return;

    const state = stateFor(discussionId);
    const prompt = buildInsightPrompt({ snapshot, maxNew: 2 });

    let parsed;
    try {
      const result = await deps.llm.json({
        prompt,
        signal: AbortSignal.timeout(deps.config.llm.timeouts.insight),
        timeoutMs: prompt.timeoutMs ?? deps.config.llm.timeouts.insight,
        parse: parseInsightOutput,
        meta: {
          discussionId,
          scenario: state.scenario,
          turnIndex: snapshot.turnCount,
          expertCount: snapshot.expertCount,
          roster: snapshot.experts.map((e) => ({ id: e.id, role: e.role, name: e.name })),
          topic: snapshot.topic,
          messageIds: snapshot.messages.map((m) => m.id),
          insights: snapshot.insights.map((i) => ({ id: i.id, type: i.type, content: i.content })),
        },
      });
      parsed = result.value;
    } catch (error) {
      // Failure keeps the previous snapshot and emits nothing (docs/06 §1.7).
      const kind = error instanceof LlmError ? error.kind : "unknown";
      deps.log.warn({ discussionId, kind }, "insight extraction failed; keeping snapshot");
      return;
    }

    const normalized = normalizeInsights(parsed.insights, snapshot, {
      turnIndex: snapshot.turnCount + 1,
      maxNew: 2,
    });

    // Observability: a silent "0 accepted" is exactly how the consensus panel goes
    // blank without any error, so record the rejection reasons (never the text).
    if (normalized.rejected.length > 0 || normalized.insights.length === 0) {
      deps.log.info(
        {
          discussionId,
          turnCount: snapshot.turnCount,
          messageCount: snapshot.messages.length,
          accepted: normalized.insights.length,
          rejected: normalized.rejected.map((r) => r.reason).slice(0, 6),
        },
        "insight normalization",
      );
    }

    const validIds = new Set(snapshot.messages.map((m) => m.id));
    const before = fingerprint(snapshot.insights);
    const next = deps.repos.insights.replaceSnapshot(
      discussionId,
      normalized.insights.map((item) => ({
        type: item.type,
        content: item.content,
        evidenceMessageIds: item.evidenceMessageIds,
        firstSeenTurn: item.firstSeenTurn,
      })),
      snapshot.turnCount,
      deps.clock(),
      validIds,
    );

    if (before === fingerprint(next)) return;

    try {
      deps.events.append({
        discussionId,
        type: "insight.updated",
        payload: { insights: next.map(toInsightDto) },
      });
      if (normalized.rejected.length > 0) {
        deps.log.info(
          { discussionId, rejected: normalized.rejected.length },
          "insights partially rejected",
        );
      }
    } catch (error) {
      deps.log.warn({ discussionId, err: (error as Error).message }, "insight event rejected");
    }
  }

  async function drain(discussionId: string): Promise<void> {
    const state = stateFor(discussionId);
    while (state.pending) {
      state.pending = false;
      await extract(discussionId);
    }
  }

  return {
    notify(discussionId: string, scenario: MockScenario = "normal"): void {
      const state = stateFor(discussionId);
      state.scenario = scenario;
      state.pending = true;
      if (state.running) return;
      state.running = drain(discussionId)
        .catch((error: unknown) => {
          deps.log.warn({ discussionId, err: (error as Error).message }, "insight drain failed");
        })
        .finally(() => {
          state.running = null;
        });
    },

    async flush(discussionId: string, timeoutMs: number): Promise<void> {
      const state = states.get(discussionId);
      if (!state?.running) return;
      await Promise.race([
        state.running,
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, timeoutMs);
          timer.unref?.();
        }),
      ]);
    },

    isBusy(discussionId: string): boolean {
      return Boolean(states.get(discussionId)?.running);
    },
  };
}

function fingerprint(
  insights: readonly { id: string; content: string; evidenceMessageIds: string[] }[],
): string {
  return insights
    .map((i) => `${i.id}|${i.content}|${i.evidenceMessageIds.join(",")}`)
    .sort()
    .join("\n");
}
