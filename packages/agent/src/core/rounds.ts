/**
 * 轮次与收敛的公共常量（**以观点饱和为准，轮数只是保底**）。
 *
 * 用户/PM 的纠正（2026-11-01）：
 * - 讨论是否结束由观点/争点决定，轮数不是目标；
 * - 轮数只有两个作用：**覆盖保底**（不能太早收）与**安全上限**（不能无限跑）。
 */

/** 安全上限：到 36 必须收，并在总结里列出未解决争点。 */
export const MAX_TURNS = 36;

/** 每位专家至少要说的次数（覆盖保底的一部分）。 */
export const MIN_EXPERT_SPEAKS = 2;

/** 判定"最近是否还在产生新东西"的窗口（轮）。 */
export const STALE_WINDOW = 4;

/**
 * 覆盖保底：`2n + 2`（每位专家 2 次 + 主持人开场与至少 1 次追问），上限 12。
 *
 * n=3 → 8，n=4 → 10，n=5 → 12，n=6 → 12（2*6+2=14 被上限截到 12）。
 * 它表示"不能早于第几轮收"，**不是目标轮次**。
 */
export function coverageFloorFor(expertCount: number): number {
  const n = Math.min(6, Math.max(3, Math.trunc(expertCount)));
  return Math.min(12, 2 * n + 2);
}
