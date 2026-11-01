import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Layout contract tests for the studio shell.
 *
 * jsdom has no layout engine, so these assertions read `styles.css` and check
 * the *declarations* that the three-stage grid depends on. This is exactly the
 * regression that shipped once already: `grid-template-areas` named `rail` and
 * `insights`, but every child still declared `grid-area: stage`, so all three
 * panels landed on top of each other and only the last one was visible.
 *
 * A real boundingBox assertion needs a browser; these tests fail loudly if the
 * grid contract is broken again, which is the part a unit test can own.
 */

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/** Return the body of the first `opener { … }` block, brace-matched. */
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

/** `grid-template-areas` rows as arrays of area names. */
function templateRows(block: string): string[][] {
  const match = /grid-template-areas:\s*([\s\S]*?);/.exec(block);
  if (!match) throw new Error("grid-template-areas not found");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((row) =>
    row[1].trim().split(/\s+/),
  );
}

/**
 * Last-wins scan of every `.studio-* { … grid-area: x }` rule in file order.
 * The min-width media queries are authored in ascending order, so the final
 * value per selector is the one that applies at the widest breakpoint.
 */
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

const base = blockOf(css, "@layer components {");
const mobile = blockOf(css, "@media (max-width: 47.9375rem)");
const tablet = blockOf(css, "@media (min-width: 48rem)");
const desktop = blockOf(css, "@media (min-width: 64rem)");
const wide = blockOf(css, "@media (min-width: 90rem)");

describe("studio shell grid contract", () => {
  it("declares three distinct columns at ≥1440 and assigns every region", () => {
    const rows = templateRows(wide);
    expect(rows[1]).toEqual(["rail", "stage", "insights"]);

    expect(tablet).toMatch(/\.studio-rail\s*\{[^}]*grid-area:\s*rail/);
    expect(tablet).toMatch(/\.studio-stage\s*\{[^}]*grid-area:\s*stage/);
    expect(wide).toMatch(/\.studio-insights\s*\{[^}]*grid-area:\s*insights/);
  });

  it("never lets two panels claim the same grid area at ≥1440", () => {
    const areas = gridAreaBySelector(css);
    const used = [
      areas.get("studio-rail"),
      areas.get("studio-stage"),
      areas.get("studio-insights"),
    ];

    expect(used.every(Boolean)).toBe(true);
    expect(new Set(used).size).toBe(3);
  });

  it("has one child per named area in every desktop template", () => {
    const areas = gridAreaBySelector(css);

    // 64rem only narrows the rail width; it inherits the 48rem template.
    for (const [name, block] of [
      ["48rem", tablet],
      ["90rem", wide],
    ] as const) {
      const named = new Set(templateRows(block).flat());
      for (const area of named) {
        if (area === "header") {
          expect(base).toMatch(/\.studio-header\s*\{[^}]*grid-area:\s*header/);
          continue;
        }
        if (area === "footer" || area === "tabbar") continue;
        const owners = [...areas.entries()]
          .filter(([selector]) => selector !== "studio-shell")
          .filter(([, value]) => value === area)
          .map(([selector]) => selector);
        expect(owners, `area "${area}" in ${name} has no owning panel`).not.toHaveLength(
          0,
        );
      }
    }
  });

  it("stacks the panels behind a tab bar on mobile instead of overlapping them", () => {
    // Below 768 all three share the `stage` slot on purpose: the media query
    // below hides every inactive tab, so exactly one panel is ever laid out.
    const areaRule = /\.studio-rail\s*\{[^}]*grid-area:\s*([a-z-]+)/.exec(base);
    expect(areaRule?.[1]).toBe("stage");

    expect(mobile).toMatch(
      /\.studio-rail\[data-tab-active="false"\][\s\S]*?\{\s*display:\s*none/,
    );
    expect(mobile).toMatch(
      /\.studio-insights\[data-tab-active="false"\][\s\S]*?\{\s*display:\s*none/,
    );
  });

  it("keeps the insight drawer out of the grid below 1440", () => {
    // Overlay drawer: fixed positioning means it cannot squeeze the transcript.
    expect(tablet).toMatch(/\.studio-insights\s*\{[^}]*position:\s*fixed/);
    expect(wide).toMatch(/\.studio-insights\s*\{[^}]*position:\s*static/);
  });

  it("keeps the page itself from scrolling", () => {
    const baseLayer = blockOf(css, "@layer base {");
    expect(baseLayer).toMatch(/body\s*\{[^}]*overflow:\s*hidden/);
    expect(baseLayer).toMatch(/html,\s*body,\s*#root\s*\{[^}]*height:\s*100%/);
    expect(base).toMatch(/\.scroll-y\s*\{[^}]*overflow-y:\s*auto/);
    expect(base).toMatch(/min-height:\s*0/);
  });
});
