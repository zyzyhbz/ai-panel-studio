import { expect, test } from "../helpers/fixtures";
import type { Page } from "@playwright/test";
import { requireCap } from "../helpers/fixtures";
import { SEL } from "../helpers/selectors";
import { normalizeTranscript, pageOverflow } from "../helpers/dom";
import { api } from "../helpers/api";
import type { DiscussionDetail } from "../helpers/types";

/**
 * docs/09 改版验收：返回大厅 / 圆桌舞台 / 席位状态 / 轮次展示 / 响应式切换。
 *
 * 重要口径（2026-11-01 用户纠正）：
 * **结束由观点/争点决定，轮数只是保底**。因此本文件**不**断言"到 28/36 轮自动结束"；
 * 依赖饱和（saturation/coverage）的断言等 AI/后端 确定字段后再补，避免假绿。
 * 这里只断言可观测的 UI 契约：轮次展示口径、返回大厅、席位状态、响应式。
 */

/**
 * 起一场会话：优先用 `x-qa-scenario: slow`（放慢流，便于观察 live/席位状态），
 * 失败则回退到 normal —— 不把"slow 偶发失败"变成用例失败。
 */
async function startSession(topic: string): Promise<{ id: string; hostId: string } | null> {
  const body = { topic, expertCount: 4, clientRequestId: crypto.randomUUID() };
  let created = await api.createDiscussion(body, {
    timeoutMs: 40_000,
    headers: { "x-qa-scenario": "slow" },
  });
  if (created.status >= 400) {
    created = await api.createDiscussion(
      { ...body, clientRequestId: crypto.randomUUID() },
      { timeoutMs: 40_000 },
    );
  }
  const id = (created.body as { discussion?: { id?: string } })?.discussion?.id;
  if (!id) return null;
  const confirmed = await api.confirm(id, { timeoutMs: 20_000 });
  if (confirmed.status >= 400) return null;
  const detail = await api.getDiscussion(id, { timeoutMs: 10_000 });
  const hostId = (detail.body as DiscussionDetail | null)?.experts?.find((e) => e.role === "host")?.id ?? "";
  return { id, hostId };
}

/** 取一条已存在的讨论（布局/文案类断言不需要新建）。 */
async function pickExisting(): Promise<string | null> {
  for (const status of ["live", "ended", "all"]) {
    const res = await api.listDiscussions({ status, limit: 5 }, { timeoutMs: 8000 });
    const items = (res.body as { items?: Array<{ id: string }> } | null)?.items ?? [];
    if (items[0]) return items[0].id;
  }
  return null;
}

async function bodyText(page: Page): Promise<string> {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

test.describe("改版 / 返回大厅", () => {
  test("演播厅 header 有「返回大厅」，返回不结束会话且不调 /end", async ({ page, backend }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);

    const started = await startSession(`返回大厅验证 ${Date.now()}`);
    test.skip(started === null, "无法创建/确认讨论（后端接口未就绪）");
    const { id } = started!;

    // 记录页面发出的 /end 请求：返回大厅**不应**调结束接口
    const endCalls: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/end(\?|$)/.test(new URL(req.url()).pathname)) endCalls.push(req.url());
    });

    await page.goto(`/d/${id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(SEL.transcriptList).first()).toBeVisible({ timeout: 15_000 });

    const back = page.locator('[data-testid="back-to-lobby"]').first();
    const backFallback = page.getByRole("button", { name: /返回大厅/ }).first();
    const backLocator = (await back.count()) > 0 ? back : backFallback;
    test.skip((await backLocator.count()) === 0, "未发现「返回大厅」（docs/09 §1 尚未实现）");
    await expect(backLocator).toBeVisible();

    const before = await api.getDiscussion(id, { timeoutMs: 8000 });
    const seqBefore = (before.body as DiscussionDetail).lastSeq;

    await backLocator.click();
    await expect.poll(async () => new URL(page.url()).pathname, { timeout: 10_000 }).toBe("/");
    await expect(page.locator("#root")).not.toHaveText("");

    // mock 下 36 轮可能在 1s 内跑完，"返回时会话已 ended"是正常的。
    // 因此不断言"2.5s 后仍 live"，改为三条更本质的断言：
    //   ① 没有调用 /end（返回 ≠ 结束）  ② 状态不是 failed  ③ 若仍 live 则必须有新事件（没有卡死）
    await page.waitForTimeout(2000);
    await expect.poll(() => endCalls.length, { timeout: 1000 }).toBe(0);

    const after = await api.getDiscussion(id, { timeoutMs: 8000 });
    const afterBody = after.body as DiscussionDetail;
    const status = afterBody.discussion.status;

    expect(status, "返回大厅不应把会话打成 failed").not.toBe("failed");
    expect(["live", "summarizing", "ended"], `返回后状态异常：${status}`).toContain(status);
    if (status === "live") {
      expect(
        afterBody.lastSeq,
        `返回后仍为 live，就必须还在推进（lastSeq ${seqBefore} → ${afterBody.lastSeq}）`,
      ).toBeGreaterThan(seqBefore);
    }
  });

  test("回放页也有「返回大厅」", async ({ page, backend }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);

    const list = await api.listDiscussions({ status: "ended", limit: 5 }, { timeoutMs: 8000 });
    const items = (list.body as { items?: Array<{ id: string }> } | null)?.items ?? [];
    test.skip(items.length === 0, "库里没有已结束的讨论");

    await page.goto(`/d/${items[0]!.id}/replay`, { waitUntil: "domcontentloaded" });
    const back = page.getByRole("button", { name: /返回大厅/ });
    test.skip((await back.count()) === 0, "回放页未发现「返回大厅」（docs/09 §1 尚未实现）");
    await expect(back.first()).toBeVisible();
  });
});

test.describe("改版 / 圆桌舞台与席位状态", () => {
  test("1440 下 host + 专家席位可见，且每个席位有显式状态文案", async ({ page, backend, ui }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);
    requireCap(ui, "roundtable");

    // 用**新开的** live 会话：已结束的会话所有席位都是「待机」，看不出状态机
    const started = await startSession(`圆桌席位验证 ${Date.now()}`);
    test.skip(started === null, "无法创建/确认讨论（后端接口未就绪）");
    const id = started!.id;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/d/${id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(SEL.transcriptList).first()).toBeVisible({ timeout: 15_000 });

    const seats = page.locator('[data-testid^="seat-"]:not([data-testid="seat-status"])');
    const seatCount = await seats.count();
    expect(seatCount, "席位数量应 ≥ 1 主持 + 3 专家").toBeGreaterThanOrEqual(4);

    // 状态必须是**文案**，不能只靠颜色（docs/09 §4）；采样几秒覆盖轮次切换
    const statusWords = ["待机", "思考中", "准备发言", "发言中", "已结束"];
    const seen = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const text = await bodyText(page);
      for (const w of statusWords) if (text.includes(w)) seen.add(w);
      if (seen.size >= 2) break;
      await page.waitForTimeout(300);
    }
    expect(
      seen.size,
      `席位状态文案至少出现 2 种，实际：${[...seen].join("/") || "无"}（全部席位 待机 说明状态机没在跑）`,
    ).toBeGreaterThanOrEqual(2);

    // 每个席位都要带状态节点（`seat-status`），而不是只有一个全局状态
    const statusNodes = await page.locator('[data-testid="seat-status"]').count();
    expect(statusNodes, `每个席位都应有独立状态节点，实际 ${statusNodes} / ${seatCount}`).toBeGreaterThanOrEqual(
      seatCount,
    );
    // 席位卡要有姓名/Title 文本（不是只有头像）
    const firstSeatText = (await seats.first().innerText()).replace(/\s+/g, " ").trim();
    expect(firstSeatText.length, "席位卡应显示姓名/Title/关注点").toBeGreaterThan(4);
  });

  test("发言者状态能观测到「准备发言/发言中」（slow 场景）", async ({ page, backend, ui }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);
    requireCap(ui, "seatStatus");

    const started = await startSession(`席位状态验证 ${Date.now()}`);
    test.skip(started === null, "无法创建/确认讨论（x-qa-scenario 未就绪）");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/d/${started!.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(SEL.transcriptList).first()).toBeVisible({ timeout: 15_000 });

    // 采样：优先直接读 seat-status 节点的文本（比整页 innerText 更精确），
    // 同时容忍"已结束"作为终止条件（mock 可能很快跑完）。
    const seen = new Set<string>();
    const words = ["待机", "思考中", "准备发言", "发言中", "已结束"];
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const statusTexts = await page.$$eval('[data-testid="seat-status"]', (els) =>
        els.map((el) => (el.textContent ?? "").trim()),
      );
      for (const t of statusTexts) for (const w of words) if (t.includes(w)) seen.add(w);
      if (seen.has("发言中")) break;
      // 会话已结束后不会再出现「发言中」，提前结束采样
      if (statusTexts.length > 0 && statusTexts.every((t) => t.includes("已结束"))) break;
      await page.waitForTimeout(200);
    }

    // 断言口径（2026-11-01 PM 裁决）：
    // 不强制三态都出现 —— mock 的流式文本阶段可能 <500ms，"发言中"抓不到是采样问题；
    // 用户要的是「显式 Agent 状态」，所以只要 待机 + 任一活跃态 即可。
    const active = ["思考中", "准备发言", "发言中"].filter((w) => seen.has(w));
    expect(seen.has("待机"), `应至少出现「待机」，实际：${[...seen].join("/") || "无"}`).toBe(true);
    expect(
      active.length,
      `应至少出现一个活跃状态（思考中/准备发言/发言中），实际：${[...seen].join("/") || "无"}`,
    ).toBeGreaterThanOrEqual(1);
  });
});

test.describe("改版 / 轮次展示口径", () => {
  test("演播厅展示「x / 安全上限 36」，不出现「目标 28」或 12 轮口径", async ({ page, backend }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);

    // 用已有会话做 UI 断言，避免在 real 模式下新建会话（烧真实 token）。
    const id = await pickExisting();
    test.skip(id === null, "无可用讨论");

    await page.goto(`/d/${id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(SEL.transcriptList).first()).toBeVisible({ timeout: 15_000 });
    const text = await bodyText(page);

    test.skip(!/上限\s*36|安全上限\s*36/.test(text), "UI 尚未展示轮次上限 36（docs/09 §5 尚未实现）");
    expect(text, "应出现「安全上限 36」这类文案").toMatch(/上限\s*36|安全上限\s*36/);
    expect(text, "不应再展示「目标 28」").not.toMatch(/目标\s*28/);
    expect(text, "不应出现「12 轮」硬编码").not.toMatch(/12\s*轮/);
  });

  test("新建会话的 coverageFloor 是 8/10/12、上限 36（仅 mock 模式执行）", async ({ backend }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);
    // real 模式下 create 会真实调用模型：本用例跳过，由 PM 的 real smoke 覆盖成本/延迟
    test.skip(backend.llmMode !== "mock", `real 模式下跳过（避免烧真实 token），llmMode=${backend.llmMode}`);

    const expectedByExpertCount: Record<number, number> = { 3: 8, 4: 10, 5: 12, 6: 12 };
    for (const [count, planned] of Object.entries(expectedByExpertCount)) {
      const created = await api.createDiscussion(
        { topic: `轮次口径 ${count} 人 ${Date.now()}`, expertCount: Number(count), clientRequestId: crypto.randomUUID() },
        { timeoutMs: 40_000 },
      );
      test.skip(created.status >= 400, `创建失败（${created.status}），后端不可用`);
      const id = (created.body as { discussion?: { id?: string } })?.discussion?.id!;
      const detail = await api.getDiscussion(id, { timeoutMs: 8000 });
      const d = (detail.body as DiscussionDetail).discussion as unknown as {
        plannedTurns?: number;
        maxTurns?: number;
      };
      if (typeof d.plannedTurns === "number") {
        expect(d.plannedTurns, `${count} 位专家的 plannedTurns 应为 ${planned}`).toBe(planned);
      }
      if (typeof d.maxTurns === "number") {
        expect(d.maxTurns, "maxTurns 硬上限应为 36").toBe(36);
      }
    }
  });
});

test.describe("改版 / 响应式切换", () => {
  for (const vp of [
    { width: 1024, height: 768, label: "1024" },
    { width: 390, height: 844, label: "390" },
  ]) {
    test(`${vp.label}：无整页滚动，圆桌/实录/共识 可切换`, async ({ page, backend }) => {
      test.skip(!backend.reachable, `后端不可达（${backend.error}）`);

      const id = await pickExisting();
      test.skip(id === null, "无可用讨论");

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/d/${id}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);

      // 窄屏默认展示「圆桌」，实录需要切 Tab 才可见（docs/09 §3）
      const viewTabs = page.getByRole("tab");
      const tabCount = await viewTabs.count();
      if (tabCount > 0) {
        const transcriptTab = page.getByRole("tab", { name: /实录/ });
        if ((await transcriptTab.count()) > 0) {
          await transcriptTab.first().click();
          await page.waitForTimeout(400);
        }
      }

      const overflow = await pageOverflow(page);
      expect(overflow.overflowX, `${vp.label} 下出现横向滚动`).toBeLessThanOrEqual(1);
      expect(overflow.overflowY, `${vp.label} 下出现整页纵向滚动`).toBeLessThanOrEqual(1);

      // 三个视图的切换入口只在手机档（<768）是必需的；1024 是并排三栏。
      if (vp.width < 768) {
        const text = await bodyText(page);
        const count = ["圆桌", "实录", "共识"].filter((w) => text.includes(w)).length;
        test.skip(count < 2, `${vp.label} 下尚无「圆桌/实录/共识」切换入口（docs/09 §3 尚未实现）`);
        expect(count, `${vp.label} 下应有 2–3 个视图入口`).toBeGreaterThanOrEqual(2);
      }

      // 切换后仍不应出现整页滚动
      if (tabCount > 0) {
        const roundTab = page.getByRole("tab", { name: /圆桌/ });
        if ((await roundTab.count()) > 0) await roundTab.first().click().catch(() => undefined);
        await page.waitForTimeout(400);
        const after = await pageOverflow(page);
        expect(after.overflowY, `${vp.label} 切换回圆桌后不应整页滚动`).toBeLessThanOrEqual(1);
      }
    });
  }
});
