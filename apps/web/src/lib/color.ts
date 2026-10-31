/** Expert colour helpers. Colours come from the server; we never remap them
 *  (that would break "same colour as the speaker" intuition) — we only guard
 *  against invalid values and pick a readable foreground. */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const FALLBACK = "#8fa3bf";

export function safeColor(input: string | null | undefined): string {
  if (!input) return FALLBACK;
  const value = input.trim();
  return HEX.test(value) ? value : FALLBACK;
}

function expand(hex: string): string {
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const value = expand(safeColor(hex));
  const r = channel(parseInt(value.slice(1, 3), 16));
  const g = channel(parseInt(value.slice(3, 5), 16));
  const b = channel(parseInt(value.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Foreground that stays readable on top of an expert-coloured chip. */
export function readableInk(hex: string): string {
  return relativeLuminance(hex) > 0.55 ? "#05070a" : "#ffffff";
}

/** 12% tint of an expert colour, for spotlight washes. */
export function tint(hex: string, percent = 12): string {
  return `color-mix(in oklab, ${safeColor(hex)} ${percent}%, transparent)`;
}

/** Stable per-expert CSS variable so the spotlight layer can animate. */
export function expertVar(hex: string): Record<string, string> {
  return { "--speaker": safeColor(hex) };
}
