import { expect, test } from "../helpers/fixtures";
import { AA_BODY, contrastRatio } from "../helpers/contrast";
import { pageOverflow } from "../helpers/dom";
import { api } from "../helpers/api";

/**
 * docs/09 §2：三套主题 token（Atelier / Nocturne / Paper & Ink）。
 *
 * 断言策略：不看截图，直接读 `[data-theme]` 下的 CSS 变量算对比度，
 * 这样换色值、调主题都能自动回归，不会因为"看起来还行"放过低对比度。
 */

const THEMES = ["atelier", "nocturne", "paper"] as const;

/** 读根节点上的一组 token。 */
async function readTokens(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const pick = (name: string) => cs.getPropertyValue(name).trim();
    return {
      applied: root.getAttribute("data-theme"),
      stage: pick("--color-stage-1000"),
      ink1: pick("--color-ink-1"),
      ink3: pick("--color-ink-3"),
      live: pick("--color-live"),
      seat: pick("--color-seat"),
      wood: pick("--color-wood"),
    };
  });
}

async function setTheme(page: import("@playwright/test").Page, theme: string) {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForTimeout(120);
}

test.describe("主题 / 三套 token", () => {
  test("三套主题都能生效，且 --color-stage-1000 各不相同", async ({ page }) => {

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const seen = new Map<string, string>();

    for (const theme of THEMES) {
      await setTheme(page, theme);
      const tokens = await readTokens(page);
      expect(tokens.applied, `data-theme 应可设为 ${theme}`).toBe(theme);
      expect(tokens.stage, `${theme} 的 --color-stage-1000 不应为空`).not.toBe("");
      expect(tokens.ink1, `${theme} 的 --color-ink-1 不应为空`).not.toBe("");
      seen.set(theme, tokens.stage.toLowerCase());
    }

    const distinct = new Set(seen.values());
    expect(
      distinct.size,
      `三套主题的背景色应互不相同，实际：${[...seen.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`,
    ).toBe(THEMES.length);
  });

  for (const theme of THEMES) {
    test(`${theme}：正文对比度达标（ink/secondary vs 背景 ≥ ${AA_BODY}）`, async ({ page }) => {
  
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await setTheme(page, theme);
      const t = await readTokens(page);

      const body = contrastRatio(t.ink1, t.stage);
      const secondary = contrastRatio(t.ink3, t.stage);
      expect(body, `${theme}: 正文对比度算不出来（ink1=${t.ink1} stage=${t.stage}）`).not.toBeNull();
      expect(body!, `${theme}: 正文对比度 ${body} 低于 ${AA_BODY}`).toBeGreaterThanOrEqual(AA_BODY);
      // 次要文本允许略低，但不应低于 4.5（docs/09 §2 要求正文清晰）
      if (secondary !== null) {
        expect(secondary, `${theme}: 次要文本对比度 ${secondary} 低于 4.5`).toBeGreaterThanOrEqual(AA_BODY);
      }
    });
  }

  test("切换主题不破版：1440 无整页滚动、关键容器仍在视口内", async ({ page }) => {

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    for (const theme of THEMES) {
      await setTheme(page, theme);
      const overflow = await pageOverflow(page);
      expect(overflow.overflowX, `${theme}: 1440 下出现横向滚动`).toBeLessThanOrEqual(1);
      expect(overflow.overflowY, `${theme}: 1440 下出现整页纵向滚动`).toBeLessThanOrEqual(1);

      const header = page.locator("header").first();
      await expect(header, `${theme}: header 应可见`).toBeVisible();
      const box = await header.boundingBox();
      expect(box, `${theme}: header 应有 boundingBox`).not.toBeNull();
      expect(box!.width, `${theme}: header 应铺满视口宽度`).toBeGreaterThanOrEqual(1436);
    }
  });

  test("主题 token 不散落硬编码：body 背景由变量驱动", async ({ page }) => {

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await setTheme(page, "nocturne");
    const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(after, "切换 data-theme 后 body 背景色应随之变化（说明颜色走 CSS 变量）").not.toBe(before);
  });
});
