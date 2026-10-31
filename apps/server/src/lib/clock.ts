/**
 * Single source of "now" so tests can freeze time.
 * Always 24-char ISO-8601 UTC, so lexicographic order === chronological order.
 */
export type Clock = () => string;

export const systemClock: Clock = () => new Date().toISOString();

export function isIsoUtc(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
}

export function fixedClock(value: string): Clock {
  return () => value;
}

export function advanceableClock(start: string): { clock: Clock; advance: (ms: number) => void } {
  let t = Date.parse(start);
  return {
    clock: () => new Date(t).toISOString(),
    advance: (ms: number) => {
      t += ms;
    },
  };
}
