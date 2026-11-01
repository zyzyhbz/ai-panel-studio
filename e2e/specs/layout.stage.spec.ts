import { expect, test } from "../helpers/fixtures";
import type { Page } from "@playwright/test";
import { SEL } from "../helpers/selectors";
import { normalizeTranscript, pageOverflow } from "../helpers/dom";
import { api } from "../helpers/api";

/**
 * 布局回归：改版后的演播厅三区（docs/09 §3）。
 *
 * 历史：
 * - 2026-11-01 上午：`.studio-rail/.studio-stage/.studio-insights` 三栏子项都写成
 *   `grid-area: stage`，1440 下三栏重叠、只剩 InsightPanel 可见 → 修复后加回归。
 * - 2026-11-01 下午改版：演播厅改为「现场实录 | 圆桌舞台 | 共识」三区，
 *   容器换成 `[data-testid="transcript"]` / `round-table` / 右侧洞察栏。
 *   本文件因此按"三区"而不是"旧三栏"断言。
 */

/** 左：现场实录；中：圆桌舞台；右：共识/分歧/待验证。 */
const PANELS = {
  transcript: '[data-testid="transcript"]',
  roundtable: '[data-testid="round-table"]',
  insights: '[data-testid="insight-panel"], .studio-insights, [data-testid="insights-panel"]',
} as const;

async function pickDiscussionId(): Promise<{ id: string; reason?: string }> {
  for (const status of ["ended", "live", "all"]) {
    const res = await api.listDiscussions({ status, limit: 5 }, { timeoutMs: 8000 });
    const items = (res.body as { items?: Array<{ id: string }> } | null)?.items ?? [];
    if (items[0]) return { id: items[0].id };
  }
  return { id: "", reason: "库里没有可用讨论（后端不可达或未 seed）" };
}

async function box(page: Page, selector: string) {
  const locator = page.locator(selector).first();
  await expect(locator, `布局容器应存在：${selector}`).toBeVisible();
  const b = await locator.boundingBox();
  expect(b, `布局容器应有 boundingBox：${selector}`).not.toBeNull();
  return b!;
}

function overlapsHorizontally(
  a: { x: number; width: number },
  b: { x: number; width: number },
  tolerance = 1,
): boolean {
  return a.x + a.width > b.x + tolerance && b.x + b.width > a.x + tolerance;
}

test.describe("布局回归 / 演播厅三区", () => {
  test("1440×900：实录 / 圆桌 / 共识 三区并排不重叠，且铺满视口宽度", async ({ page, backend }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);
    const picked = await pickDiscussionId();
    test.skip(picked.id === "", picked.reason ?? "无可用讨论");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/d/${picked.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(SEL.transcriptList).first()).toBeVisible({ timeout: 15_000 });

    const left = await box(page, PANELS.transcript);
    const center = await box(page, PANELS.roundtable);
    const right = await box(page, PANELS.insights);

    for (const [name, b] of [
      ["实录", left],
      ["圆桌", center],
      ["共识", right],
    ] as const) {
      expect(b.width, `${name} 宽度应 > 120px（当前 ${b.width}）`).toBeGreaterThan(120);
      expect(b.height, `${name} 高度应 > 200px（当前 ${b.height}）`).toBeGreaterThan(200);
    }

    expect(
      overlapsHorizontally(left, center),
      `实录与圆桌水平重叠：left.right=${left.x + left.width}, center.x=${center.x}`,
    ).toBe(false);
    expect(
      overlapsHorizontally(center, right),
      `圆桌与共识水平重叠：center.right=${center.x + center.width}, right.x=${right.x}`,
    ).toBe(false);
    expect(overlapsHorizontally(left, right), "实录与共识不应水平重叠").toBe(false);

    expect(left.x, "实录应贴左边").toBeLessThanOrEqual(2);
    expect(right.x + right.width, "共识区应覆盖到视口右边缘").toBeGreaterThanOrEqual(1440 - 2);

    const overflow = await pageOverflow(page);
    expect(overflow.overflowX, "1440 下不应横向滚动").toBeLessThanOrEqual(1);
    expect(overflow.overflowY, "1440 下不应整页纵向滚动").toBeLessThanOrEqual(1);
  });

  test("1440×900：首条消息可见（不是空壳）且落在实录区内", async ({ page, backend }) => {
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

    const msgBox = await first.boundingBox();
    const panel = await box(page, PANELS.transcript);
    expect(msgBox, "首条消息应有 boundingBox").not.toBeNull();
    expect(msgBox!.x, "首条消息应在实录区内").toBeGreaterThanOrEqual(panel.x - 1);
    expect(msgBox!.x + msgBox!.width, "首条消息不应溢出实录区右边界")
      .toBeLessThanOrEqual(panel.x + panel.width + 2);
  });

  test("圆桌舞台可见，席位数 = 1 主持 + N 专家（docs/09 §3）", async ({ page, backend }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);
    const picked = await pickDiscussionId();
    test.skip(picked.id === "", picked.reason ?? "无可用讨论");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/d/${picked.id}`, { waitUntil: "domcontentloaded" });

    const table = page.locator(PANELS.roundtable).first();
    await expect(table, "应渲染圆桌舞台").toBeVisible({ timeout: 15_000 });

    const detail = await api.getDiscussion(picked.id, { timeoutMs: 8000 });
    const experts = ((detail.body as { experts?: unknown[] } | null)?.experts ?? []).length;
    const seats = await page.locator('[data-testid^="seat-"]:not([data-testid="seat-status"])').count();
    expect(seats, `席位数应等于阵容人数（${experts}）`).toBe(experts);
    expect(seats, "至少 1 主持 + 3 专家").toBeGreaterThanOrEqual(4);
  });

  for (const vp of [
    { width: 1024, height: 768, label: "1024" },
    { width: 390, height: 844, label: "390" },
  ]) {
    test(`${vp.width}×${vp.height}（${vp.label}）：不出现 body 整体滚动`, async ({ page, backend }) => {
      test.skip(!backend.reachable, `后端不可达（${backend.error}）`);
      const picked = await pickDiscussionId();
      test.skip(picked.id === "", picked.reason ?? "无可用讨论");

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/d/${picked.id}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);

      // 窄屏是 Tab 视图：默认可能停在「圆桌」，先点一下圆桌确保主视图被激活
      const roundTab = page.getByRole("tab", { name: /圆桌/ });
      if ((await roundTab.count()) > 0) {
        await roundTab.first().click().catch(() => undefined);
        await page.waitForTimeout(300);
      }

      // 窄屏默认展示「圆桌」；实录需要切 Tab 才可见（docs/09 §3），
      // 因此这里只要求"至少一个主视图可见"。
      const roundTable = page.locator(PANELS.roundtable).first();
      const roundTableVisible = (await roundTable.count()) > 0 && (await roundTable.isVisible());
      const transcript = page.locator(SEL.transcriptList).first();
      const transcriptVisible = (await transcript.count()) > 0 && (await transcript.isVisible());
      expect(
        roundTableVisible || transcriptVisible,
        `${vp.width} 下应至少有一个主视图可见（圆桌或实录）`,
      ).toBe(true);

      const overflow = await pageOverflow(page);
      expect(
        overflow.overflowX,
        `${vp.width} 下出现横向滚动：scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`,
      ).toBeLessThanOrEqual(1);
      expect(
        overflow.overflowY,
        `${vp.width} 下出现整页纵向滚动：scrollHeight=${overflow.scrollHeight} clientHeight=${overflow.clientHeight}`,
      ).toBeLessThanOrEqual(1);

      const scrollable = await page.$$eval(
        `${SEL.transcriptList}, [data-testid="round-table"]`,
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
