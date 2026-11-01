/**
 * 颜色工具：主题 token 的对比度计算（WCAG 2.1）。
 *
 * 用途：docs/09 §2 要求"正文对比度达标"。深色/浅色三套主题靠 CSS 变量切换，
 * 所以断言不能写死颜色值，必须现场读 `--color-*` 再算对比度。
 */

export type Rgb = { r: number; g: number; b: number; a: number };

export function parseColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase();
  if (!value || value === "transparent" || value === "none") return null;

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hex) {
    const h = hex[1]!;
    const expand = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const r = parseInt(expand.slice(0, 2), 16);
    const g = parseInt(expand.slice(2, 4), 16);
    const b = parseInt(expand.slice(4, 6), 16);
    const a = expand.length === 8 ? parseInt(expand.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  const rgb = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1]!.split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
    }
  }
  return null;
}

/** 相对亮度（sRGB → 线性化）。 */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** 对比度，(l1+0.05)/(l2+0.05)，范围 1–21。 */
export function contrastRatio(fg: string, bg: string): number | null {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return null;
  const l1 = luminance(f);
  const l2 = luminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

/** WCAG AA：正文 4.5，大字/图标 3。 */
export const AA_BODY = 4.5;
export const AA_LARGE = 3;
