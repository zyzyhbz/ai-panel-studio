import { maxTurnsFor } from "@ai-panel/shared";

/**
 * Turn policy (docs/09 §5 + PM correction 2026-11-01).
 *
 * The debate is closed by *saturation of the argument*, not by a turn count.
 * The only numbers the server owns are:
 *
 * - `coverageFloor(n) = min(12, 2n + 2)` — "cannot close earlier than this".
 *   It is NOT a target: 3 experts → 8, 4 → 10, 5 → 12, 6 → 12.
 * - `maxTurns = 36` — a safety ceiling, not a goal.
 *
 * `coverageFloor` is what the API exposes as `plannedTurns` (field kept for
 * compatibility); the agent package opens its close window at that point and
 * only actually closes when `saturation.allOk` is true (every expert spoke twice,
 * no unanswered challenge, no new insight in the last four turns) or at the cap.
 */
export function coverageFloorFor(expertCount: number): number {
  const n = Math.min(6, Math.max(3, Math.trunc(expertCount)));
  return Math.min(12, 2 * n + 2);
}

/** Safety ceiling. Mirrors `maxTurnsFor` in `@ai-panel/shared` (always 36). */
export function turnCeilingFor(expertCount: number): number {
  return maxTurnsFor(expertCount);
}
