/** Time helpers. All server timestamps are ISO 8601 UTC. */

export function parseIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** `04:38` — elapsed clock used by the live header. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function elapsedSince(
  startedAt: string | null,
  now: number,
): string | null {
  const start = parseIso(startedAt);
  if (start === null) return null;
  return formatClock(now - start);
}

/** `刚刚` / `3 分钟前` / `2 小时前` / `昨天` / `MM-DD`. */
export function formatRelative(
  iso: string | null | undefined,
  now: number = Date.now(),
): string {
  const ms = parseIso(iso);
  if (ms === null) return "—";
  const diff = Math.max(0, now - ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 2 * day) return "昨天";
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;

  const d = new Date(ms);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Short beat label for a message timestamp, e.g. `10:00:12`. */
export function formatBeat(iso: string): string {
  const ms = parseIso(iso);
  if (ms === null) return "—";
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
