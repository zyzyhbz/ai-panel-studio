import { expect, test } from "../helpers/fixtures";
import { domText } from "../helpers/scan";
import { assertClean, assertNoCot, assertNoJsonLeak, NetworkRecorder } from "../helpers/scan";
import { pageOverflow } from "../helpers/dom";
import { env } from "../helpers/env";

/**
 * 冒烟 2：前端 shell 可加载。
 *
 * 断言"能打开、能渲染、无脚本错误、无 Key/JSON 泄露、不整体横向滚动"。
 * 首页列表/创建/演播厅的功能断言分别在 create-form 与 main-chain 两个 spec 里。
 */

test.describe("冒烟 / 前端 shell", () => {
  test("首页可打开、root 有内容、无 console/pageerror、无 Key 与 JSON 泄露", async ({ page, diag, backend }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）—— 前端仍可开，但这里要求 API 一起就绪`);

    const recorder = new NetworkRecorder(page);
    const res = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(res, "首页应有响应").not.toBeNull();
    expect(res!.status(), "首页 HTTP 状态").toBeLessThan(400);

    // 1) 挂载点有内容（白屏是可观测缺陷）
    const root = page.locator("#root");
    await expect(root).toHaveCount(1);
    const rootText = (await root.innerText()).trim();
    expect(rootText.length, "root 内容为空 → 白屏").toBeGreaterThan(0);

    // 2) 页面标题非空（中文 UI 的基本要求）
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    // 3) 无脚本错误
    expect(diag.pageErrors, `页面抛错：${diag.pageErrors.join(" | ")}`).toHaveLength(0);
    expect(diag.consoleErrors, `console.error：${diag.consoleErrors.join(" | ")}`).toHaveLength(0);

    // 4) 网络响应体不含 Key / CoT / 原始 JSON 结构
    await recorder.settle();
    const all = recorder.allText();
    assertClean(all, "首页网络响应");
    assertNoCot(all, "首页网络响应");

    // 5) DOM 文本不含 Key / 原始 JSON 字段名
    const text = await domText(page);
    assertClean(text, "首页 DOM");
    assertNoCot(text, "首页 DOM");
    if (/consensus|divergence|evidenceMessageIds/.test(text)) {
      assertNoJsonLeak(text, "首页 DOM");
    }

    // 6) 页面本身不整体滚动（NFR-05 的底线，占位页也应成立）
    const overflow = await pageOverflow(page);
    expect(overflow.overflowX, "不应出现横向滚动").toBeLessThanOrEqual(1);

    // 证据：无论成败都留一张首屏截图（写到 ASCII 产物目录，避免中文路径编码问题）
    await page.screenshot({ path: `${env.artifactsDir}/screenshots/home-smoke.png`, fullPage: false });
  });

  test("首页不依赖后端也能渲染（后端不可达时仍应给出可读状态而非白屏）", async ({ page }) => {
    // 这条刻意不 skip backend：验证前端的"后端挂了"兜底。
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const rootText = (await page.locator("#root").innerText()).trim();
    expect(rootText.length, "后端不可达时 root 仍应有内容").toBeGreaterThan(0);
  });
});
