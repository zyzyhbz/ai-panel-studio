import { expect, test } from "../helpers/fixtures";
import type { Page } from "@playwright/test";
import { SEL } from "../helpers/selectors";
import { normalizeTranscript, pageOverflow } from "../helpers/dom";
import { api } from "../helpers/api";

/**
 * 布局回归：演播厅三栏（rail / stage / insights）。
 *
 * 背景（2026-11-01 真实缺陷，已修）：`styles.css` 里三栏子项都只有 `grid-area: stage`，
 * 1440 下三栏重叠成一列，页面上只剩 InsightPanel 可见。
 * 本 spec 把"三栏必须真的并排、且不整体滚动"固化成回归用例。
 *
 * 选择器用 `.studio-rail/.studio-stage/.studio-insights`，同时兼容 `[data-panel]`。
 */

/** 取一条可用的讨论：优先 ended（内容稳定），否则任意有消息的。 */
async function pickDiscussionId(): Promise<{ id: string; reason?: string }> {
  const ended = await api.listDiscussions({ status: "ended", limit: 5 }, { timeoutMs: 8000 });
  const endedItems = (ended.body as { items?: Array<{ id: string }> } | null)?.items ?? [];
  if (endedItems[0]) return { id: endedItems[0].id };

  const any = await api.listDiscussions({ limit: 5 }, { timeoutMs: 8000 });
  const anyItems = (any.body as { items?: Array<{ id: string }> } | null)?.items ?? [];
  if (anyItems[0]) return { id: anyItems[0].id };
  return { id: "", reason: "库里没有可用讨论（后端不可达或未 seed）" };
}

async function box(page: Page, selector: string) {
  const locator = page.locator(selector).first();
  await expect(locator, `布局容器应存在：${selector}`).toBeVisible();
  const b = await locator.boundingBox();
  expect(b, `布局容器应有 boundingBox：${selector}`).not.toBeNull();
  return b!;
}

/** 两个矩形在水平方向上是否重叠（允许 1px 亚像素误差）。 */
function overlapsHorizontally(
  a: { x: number; width: number },
  b: { x: number; width: number },
  tolerance = 1,
): boolean {
  return a.x + a.width > b.x + tolerance && b.x + b.width > a.x + tolerance;
}

test.describe("布局回归 / 演播厅三栏", () => {
  test("1440×900：rail / stage / insights 三栏并排不重叠，且铺满视口宽度", async ({ page, backend }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);
    const picked = await pickDiscussionId();
    test.skip(picked.id === "", picked.reason ?? "无可用讨论");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/d/${picked.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(SEL.transcriptList).first()).toBeVisible();

    const rail = await box(page, SEL.studioRail);
    const stage = await box(page, SEL.studioStage);
    const insights = await box(page, SEL.studioInsights);

    // 1) 三栏都有实际尺寸（重叠时会有一栏被压成 0 或被完全盖住）
    for (const [name, b] of [
      ["rail", rail],
      ["stage", stage],
      ["insights", insights],
    ] as const) {
      expect(b.width, `${name} 宽度应 > 120px（当前 ${b.width}）`).toBeGreaterThan(120);
      expect(b.height, `${name} 高度应 > 200px（当前 ${b.height}）`).toBeGreaterThan(200);
    }

    // 2) 水平不重叠：rail | stage | insights 依次排列
    expect(overlapsHorizontally(rail, stage), `rail 与 stage 水平重叠：rail.x=${rail.x} w=${rail.width}, stage.x=${stage.x} w=${stage.width}`).toBe(false);
    expect(overlapsHorizontally(stage, insights), `stage 与 insights 水平重叠：stage.x=${stage.x} w=${stage.width}, insights.x=${insights.x} w=${insights.width}`).toBe(false);
    expect(overlapsHorizontally(rail, insights), "rail 与 insights 不应水平重叠").toBe(false);

    // 3) 顺序正确 + 铺满视口：rail 从左侧起、insights 顶到右侧
    expect(rail.x, "rail 应贴左边").toBeLessThanOrEqual(2);
    expect(insights.x + insights.width, "insights 应覆盖到视口右边缘").toBeGreaterThanOrEqual(1440 - 2);

    // 4) 三栏合计宽度不应远超视口（重叠或错位时会异常）
    const covered = stage.x + stage.width;
    expect(covered, "stage 右边界应在 insights 左边界附近或之前").toBeLessThanOrEqual(insights.x + insights.width + 1);

    // 5) 页面不整体滚动（三栏布局的基本前提）
    const overflow = await pageOverflow(page);
    expect(overflow.overflowX, "1440 下不应出现横向滚动").toBeLessThanOrEqual(1);
    expect(overflow.overflowY, "1440 下不应出现整页纵向滚动").toBeLessThanOrEqual(1);
  });

  test("1440×900：首条消息可见（不是空壳）", async ({ page, backend }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);
    const picked = await pickDiscussionId();
    test.skip(picked.id === "", picked.reason ?? "无可用讨论");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/d/${picked.id}`, { waitUntil: "domcontentloaded" });

    await expect
      .poll(async () => (await normalizeTranscript(page)).length, {
        timeout: 20_000,
        message: "演播厅应渲染出消息（空壳回归）",
      })
      .toBeGreaterThanOrEqual(1);

    const first = page.locator(SEL.transcriptItem).first();
    await expect(first, "首条消息应可见").toBeVisible();
    const text = (await first.innerText()).replace(/\s+/g, " ").trim();
    expect(text.length, "首条消息文本不应为空").toBeGreaterThan(4);

    // 首条消息应落在 stage 栏内（三栏错位时它会跑到别的栏上面）
    const msgBox = await first.boundingBox();
    const stageBox = await box(page, SEL.studioStage);
    expect(msgBox, "首条消息应有 boundingBox").not.toBeNull();
    expect(msgBox!.x, "首条消息应在 stage 栏内").toBeGreaterThanOrEqual(stageBox.x - 1);
    expect(msgBox!.x + msgBox!.width, "首条消息不应溢出 stage 右边界")
      .toBeLessThanOrEqual(stageBox.x + stageBox.width + 2);
  });

  for (const vp of [
    { width: 1024, height: 768, label: "1024 桌面收窄" },
    { width: 390, height: 844, label: "390 手机" },
  ]) {
    test(`${vp.width}×${vp.height}（${vp.label}）：不出现 body 整体滚动`, async ({ page, backend }) => {
      test.skip(!backend.reachable, `后端不可达（${backend.error}）`);
      const picked = await pickDiscussionId();
      test.skip(picked.id === "", picked.reason ?? "无可用讨论");

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/d/${picked.id}`, { waitUntil: "domcontentloaded" });
      // 等首屏渲染稳定（避免在骨架屏阶段量尺寸）
      await page.waitForTimeout(800);

      const overflow = await pageOverflow(page);
      expect(
        overflow.overflowX,
        `${vp.width} 下出现横向滚动：scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`,
      ).toBeLessThanOrEqual(1);
      expect(
        overflow.overflowY,
        `${vp.width} 下出现整页纵向滚动：scrollHeight=${overflow.scrollHeight} clientHeight=${overflow.clientHeight}`,
      ).toBeLessThanOrEqual(1);

      // 至少一个主面板是可滚动的：内容在容器内滚，而不是把页面撑开
      const scrollable = await page.$$eval(
        `${SEL.studioStage}, ${SEL.transcriptList}`,
        (els) =>
          els.some((el) => {
            const cs = getComputedStyle(el as HTMLElement);
            return ["auto", "scroll"].includes(cs.overflowY);
          }),
      );
      expect(scrollable, `${vp.width} 下主面板应有 overflow-y: auto/scroll（区域独立滚动）`).toBe(true);
    });
  }
});
