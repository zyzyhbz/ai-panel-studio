import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Layout + palette contract tests.
 *
 * jsdom has no layout engine, so a `getBoundingClientRect` assertion would be
 * permanently 0×0 and vacuously green. These tests read `styles.css` and
 * assert the declarations the round-table shell depends on. They are the
 * regression net for two defects that already shipped once:
 *   1. `grid-template-areas` named rail/insights while every child kept
 *      `grid-area: stage` → all three panels stacked on top of each other;
 *   2. a single dark palette with no switchable tokens.
 */

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function blockOf(source: string, opener: string): string {
  const start = source.indexOf(opener);
  if (start < 0) throw new Error(`missing block: ${opener}`);
  let index = source.indexOf("{", start);
  const from = index + 1;
  let depth = 0;
  for (; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(from, index);
    }
  }
  throw new Error(`unbalanced block: ${opener}`);
}

function templateRows(block: string): string[][] {
  const match = /grid-template-areas:\s*([\s\S]*?);/.exec(block);
  if (!match) throw new Error("grid-template-areas not found");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((row) =>
    row[1].trim().split(/\s+/),
  );
}

function gridAreaBySelector(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const rule = /\.(studio-[a-z-]+)\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(source)) !== null) {
    const area = /grid-area:\s*([a-z-]+)/.exec(match[2]);
    if (area) map.set(match[1], area[1]);
  }
  return map;
}

function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of block.matchAll(/(--color-[a-z0-9-]+):\s*([^;]+);/g)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

const base = blockOf(css, "@layer components {");
const baseLayer = blockOf(css, "@layer base {");
const tabMode = blockOf(css, "@media (max-width: 63.9375rem)");
const desktop = blockOf(css, "@media (min-width: 64rem)");
const wide = blockOf(css, "@media (min-width: 90rem)");

describe("round-table shell layout", () => {
  it("gives each column its own grid area at ≥1440", () => {
    expect(templateRows(wide)[1]).toEqual(["log", "table", "insights"]);

    const areas = gridAreaBySelector(css);
    const used = [
      areas.get("studio-log"),
      areas.get("studio-table"),
      areas.get("studio-insights"),
    ];
    expect(used.every(Boolean)).toBe(true);
    expect(new Set(used).size).toBe(3);
  });

  it("backs every named area with an owning panel", () => {
    const areas = gridAreaBySelector(css);
    for (const area of new Set(templateRows(wide).flat())) {
      if (area === "header" || area === "footer" || area === "tabbar") continue;
      const owners = [...areas.entries()].filter(([, value]) => value === area);
      expect(owners, `area "${area}" has no owning panel`).not.toHaveLength(0);
    }
  });

  it("turns the panels into tabs below 1024 instead of overlapping them", () => {
    expect(tabMode).toMatch(
      /\.studio-log\[data-tab-active="false"\][\s\S]*?\{\s*display:\s*none/,
    );
    expect(tabMode).toMatch(
      /\.studio-table\[data-tab-active="false"\][\s\S]*?\{\s*display:\s*none/,
    );
    // 1024–1439 keeps the transcript column and a drawer for insights.
    expect(desktop).toMatch(/grid-template-columns:\s*clamp\(300px/);
    expect(desktop).toMatch(/\.studio-insights\s*\{[^}]*position:\s*fixed/);
    expect(wide).toMatch(/\.studio-insights\s*\{[^}]*position:\s*static/);
  });

  it("never scrolls the page itself at any width", () => {
    expect(baseLayer).toMatch(/body\s*\{[^}]*overflow:\s*hidden/);
    expect(baseLayer).toMatch(/html,\s*body,\s*#root\s*\{[^}]*height:\s*100%/);
    expect(baseLayer).toMatch(/\.scroll-y\s*\{[^}]*overflow-y:\s*auto/);
    expect(base).toMatch(/\.studio-shell\s*\{[^}]*height:\s*100dvh/);
    expect(base).toMatch(/\.panel\s*\{[^}]*min-height:\s*0/);
  });

  it("draws the round table with CSS only", () => {
    expect(base).toMatch(/\.round-table\s*\{[^}]*border-radius:\s*50%/);
    expect(base).toMatch(/\.round-seat\s*\{[^}]*position:\s*absolute/);
  });

  /**
   * Regression for the 1440 overflow bug: `body { overflow: hidden }` alone
   * does NOT stop a grid item from growing to its content height. A transcript
   * of 1304px inside a 900px viewport pushed `body.scrollHeight` to 1412.
   * Every scroll column therefore needs its own flex + min-height + overflow
   * chain, and the shell needs a clipping backstop.
   */
  it("constrains every scroll column so a tall transcript cannot grow the page", () => {
    expect(base).toMatch(/\.studio-shell\s*\{[^}]*overflow:\s*hidden/);

    expect(base).toMatch(
      /\.studio-log\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*min-height:\s*0[^}]*overflow:\s*hidden/,
    );
    expect(base).toMatch(
      /\.studio-table,\s*\n?\s*\.studio-insights\s*\{[^}]*overflow:\s*hidden/,
    );

    // Every shell template must let the middle track shrink.
    for (const [name, block] of [
      ["base", base],
      ["64rem", desktop],
      ["90rem", wide],
    ] as const) {
      const rows = /grid-template-rows:\s*([^;]+);/.exec(block);
      expect(rows, `${name} must declare grid-template-rows`).not.toBeNull();
      expect(rows?.[1], `${name} middle track must be minmax(0, 1fr)`).toMatch(
        /minmax\(\s*0\s*,\s*1fr\s*\)/,
      );
    }
  });
});

/* ------------------------------------------------------------------ *
 * Palettes
 * ------------------------------------------------------------------ */

function luminance(hex: string): number {
  const value = hex.replace("#", "").trim();
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(full.slice(0, 2), 16));
  const g = channel(parseInt(full.slice(2, 4), 16));
  const b = channel(parseInt(full.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const palettes = {
  atelier: declarations(blockOf(css, "@theme {")),
  nocturne: declarations(blockOf(css, '[data-theme="nocturne"] {')),
  paper: declarations(blockOf(css, '[data-theme="paper"] {')),
};

describe("three-palette tokens (docs/09 §2)", () => {
  it("declares all three themes", () => {
    expect(css).toContain('[data-theme="atelier"]');
    expect(css).toContain('[data-theme="nocturne"]');
    expect(css).toContain('[data-theme="paper"]');
  });

  it("defines the same token surface in every palette", () => {
    const required = [
      "--color-stage-1000",
      "--color-stage-900",
      "--color-ink-1",
      "--color-ink-2",
      "--color-ink-3",
      "--color-live",
      "--color-consensus",
      "--color-divergence",
      "--color-open",
      "--color-wood",
      "--color-seat",
    ];

    for (const [theme, tokens] of Object.entries(palettes)) {
      for (const token of required) {
        expect(tokens.get(token), `${theme} is missing ${token}`).toBeDefined();
      }
    }
  });

  it("keeps body text above 4.5:1 in every palette", () => {
    for (const [theme, tokens] of Object.entries(palettes)) {
      const surface = tokens.get("--color-stage-1000") ?? "";
      for (const ink of ["--color-ink-1", "--color-ink-2", "--color-ink-3"]) {
        const ratio = contrast(tokens.get(ink) ?? "#000000", surface);
        expect(ratio, `${theme} ${ink} contrast`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps semantic colours readable on their own surface", () => {
    for (const [theme, tokens] of Object.entries(palettes)) {
      const surface = tokens.get("--color-stage-1000") ?? "";
      for (const token of [
        "--color-consensus",
        "--color-divergence",
        "--color-open",
        "--color-live",
      ]) {
        const ratio = contrast(tokens.get(token) ?? "#000000", surface);
        expect(ratio, `${theme} ${token} contrast`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
