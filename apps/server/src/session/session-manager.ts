import type { CoreDeps, Logger } from "../context";
import type { InsightService } from "../services/insight.service";
import type { SummaryService } from "../services/summary.service";
import type { MockScenario } from "../llm/types";
import { SessionRunner, type StopReason } from "./session-runner";

export interface SessionManagerDeps extends CoreDeps {
  insights: InsightService;
  summary: SummaryService;
}

export type FinalizeReason = "user" | "auto";

export interface SessionManager {
  start(discussionId: string): void;
  requestStop(discussionId: string, reason: FinalizeReason): void;
  isActive(discussionId: string): boolean;
  activeCount(): number;
  stopAll(): Promise<void>;
  finalize(discussionId: string, reason: FinalizeReason): Promise<void>;
  startWatchdog(): () => void;
}

export function createSessionManager(deps: SessionManagerDeps): SessionManager {
  const runners = new Map<string, SessionRunner>();
  const finalizing = new Map<string, Promise<void>>();
  const log: Logger = deps.log;

  function scenarioOf(discussionId: string): MockScenario {
    const discussion = deps.repos.discussions.getById(discussionId);
    return (discussion?.qaScenario as MockScenario | null) ?? "normal";
  }

  async function finalize(discussionId: string, reason: FinalizeReason): Promise<void> {
    const inFlight = finalizing.get(discussionId);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const discussion = deps.repos.discussions.getById(discussionId);
      if (!discussion || discussion.status === "ended") return;

      const messageCount = deps.repos.messages.countByDiscussion(discussionId);
      if (discussion.status === "failed" && messageCount === 0) return;

      const now = deps.clock();
      const won =
        discussion.status === "summarizing" ||
        deps.repos.discussions.casStatus(discussionId, ["live", "failed"], "summarizing", now, {
          endedAt: null,
        });
      if (!won) {
        log.warn(
          { discussionId, status: deps.repos.discussions.getById(discussionId)?.status },
          "finalize skipped: state did not allow summarizing",
        );
        return;
      }

      if (!deps.repos.events.hasType(discussionId, "discussion.summarizing")) {
        deps.events.append({
          discussionId,
          type: "discussion.summarizing",
          payload: { reason, startedAt: now },
        });
      }

      // Pending insight work must land before the terminal events.
      await deps.insights.flush(discussionId, 3_000);

      const summary = await deps.summary.ensure(discussionId, scenarioOf(discussionId));
      if (summary) {
        const createdAt = deps.clock();
        deps.repos.summaries.upsert(discussionId, summary.content, summary.isFallback, createdAt);
        deps.events.append({
          discussionId,
          type: "summary.completed",
          payload: {
            summary: {
              content: summary.content,
              createdAt,
              isFallback: summary.isFallback,
            },
          },
        });
      }

      const endedAt = deps.clock();
      deps.events.append({ discussionId, type: "discussion.ended", payload: { endedAt } });
      deps.repos.discussions.casStatus(discussionId, ["summarizing"], "ended", deps.clock(), {
        endedAt,
      });
      deps.broadcaster.closeSession(discussionId);
      log.info({ discussionId, reason, hasSummary: Boolean(summary) }, "session finalized");
    })().finally(() => {
      finalizing.delete(discussionId);
    });

    finalizing.set(discussionId, promise);
    return promise;
  }

  /** Terminal failure without any further LLM work (shutdown / watchdog). */
  function failInterrupted(discussionId: string, why: "shutdown" | "watchdog"): void {
    const discussion = deps.repos.discussions.getById(discussionId);
    if (!discussion) return;
    const now = deps.clock();
    const won = deps.repos.discussions.casStatus(
      discussionId,
      ["live", "summarizing"],
      "failed",
      now,
      { errorCode: "INTERRUPTED", errorMessage: "讨论已中断，可回放已有内容", endedAt: now },
    );
    if (!won) return;
    try {
      deps.events.append({
        discussionId,
        type: "discussion.failed",
        allowClosed: true,
        payload: {
          code: "INTERRUPTED",
          message: why === "watchdog" ? "讨论长时间没有进展，已中断" : "服务重启，讨论已中断",
          retryable: false,
          failedAt: now,
        },
      });
    } catch (error) {
      log.warn({ discussionId, err: (error as Error).message }, "failed to append discussion.failed");
    }
    deps.broadcaster.closeSession(discussionId);
  }

  return {
    start(discussionId: string): void {
      if (runners.has(discussionId)) return;
      const runner = new SessionRunner(deps, discussionId);
      runners.set(discussionId, runner);
      log.info({ discussionId }, "session runner started");

      setImmediate(() => {
        void (async () => {
          try {
            await runner.run();
          } catch (error) {
            log.error({ discussionId, err: (error as Error).message }, "session runner crashed");
          } finally {
            runners.delete(discussionId);
            const reason = runner.finishReason;
            try {
              if (reason === "shutdown" || reason === "watchdog") {
                failInterrupted(discussionId, reason);
              } else {
                await finalize(discussionId, reason === "auto" ? "auto" : "user");
              }
            } catch (error) {
              log.error(
                { discussionId, err: (error as Error).message },
                "session finalize failed",
              );
            }
          }
        })();
      });
    },

    requestStop(discussionId: string, reason: FinalizeReason): void {
      const runner = runners.get(discussionId);
      if (runner) {
        runner.requestStop(reason);
        return;
      }
      // No runner (e.g. failed session being ended): finalize directly.
      void finalize(discussionId, reason);
    },

    isActive(discussionId: string): boolean {
      return runners.has(discussionId);
    },

    activeCount(): number {
      return runners.size;
    },

    async stopAll(): Promise<void> {
      const entries = [...runners.entries()];
      for (const [, runner] of entries) runner.requestStop("shutdown");
      await Promise.allSettled(
        entries.map(([, runner]) =>
          Promise.race([
            runner.settled(),
            new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, 3_000);
              timer.unref?.();
            }),
          ]),
        ),
      );
    },

    finalize,

    startWatchdog(): () => void {
      const interval = Math.max(250, Math.min(10_000, Math.floor(deps.config.session.watchdogMs / 3)));
      const timer = setInterval(() => {
        const now = Date.now();
        for (const [discussionId, runner] of runners) {
          if (now - runner.lastProgressAt <= deps.config.session.watchdogMs) continue;
          log.warn({ discussionId, stalledMs: now - runner.lastProgressAt }, "watchdog stopping session");
          runner.requestStop("watchdog");
        }
      }, interval);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
}

export type { StopReason };
