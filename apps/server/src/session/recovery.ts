import type { CoreDeps } from "../context";

export interface RecoveryReport {
  interrupted: number;
  staleGenerating: number;
  repairedLastSeq: number;
}

/**
 * Seeded demo fixtures use deterministic ids (`d0000001-…`). Their `live` sample is
 * an authored snapshot for the homepage, not a crashed session, so recovery must
 * not turn it into `failed(INTERRUPTED)` on every boot.
 */
export const SEED_DISCUSSION_PREFIX = "d000000";

/**
 * Boot recovery.
 *
 * Contract decision: a discussion is never resumed after a process restart —
 * `live`/`summarizing` become `failed(INTERRUPTED)`, `generating` becomes
 * `failed(INTERRUPTED)` too (no usable roster). We then append a persisted
 * `discussion.failed` event so the event log is self-contained for replay.
 *
 * Never calls the LLM (no surprise billing, no half-resumed sessions).
 */
export function recoverOnBoot(deps: CoreDeps): RecoveryReport {
  const now = deps.clock();
  const interrupted = deps.repos.discussions.markInterrupted(
    now,
    "服务重启，讨论已中断，可回放已有内容",
    SEED_DISCUSSION_PREFIX,
  );
  const stale = deps.repos.discussions.markStaleGenerating(
    now,
    "服务重启，阵容生成已中断",
    SEED_DISCUSSION_PREFIX,
  );

  for (const discussionId of [...interrupted, ...stale]) {
    if (deps.repos.events.hasType(discussionId, "discussion.failed")) continue;
    try {
      deps.events.append({
        discussionId,
        type: "discussion.failed",
        allowClosed: true,
        payload: {
          code: "INTERRUPTED",
          message: "服务重启，讨论已中断，可回放已有内容",
          retryable: false,
          failedAt: now,
        },
      });
    } catch (error) {
      deps.log.warn(
        { discussionId, err: (error as Error).message },
        "recovery: failed to append discussion.failed",
      );
    }
  }

  const repairedLastSeq = deps.repos.discussions.repairLastSeq();

  if (interrupted.length || stale.length || repairedLastSeq) {
    deps.log.info(
      { interrupted: interrupted.length, staleGenerating: stale.length, repairedLastSeq },
      "boot recovery applied",
    );
  }

  return {
    interrupted: interrupted.length,
    staleGenerating: stale.length,
    repairedLastSeq,
  };
}
