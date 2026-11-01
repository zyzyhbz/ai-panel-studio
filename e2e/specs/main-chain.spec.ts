import { expect, test } from "../helpers/fixtures";
import { requireCap, uniqueTopic } from "../helpers/fixtures";
import { SEL } from "../helpers/selectors";
import { SseClient } from "../helpers/sse";
import { normalizeTranscript } from "../helpers/dom";
import { env } from "../helpers/env";
import type { DiscussionDetail } from "../helpers/types";

/**
 * 主链路骨架（E2E-01 的 v0）：首页 → 创建 → Lobby → confirm → SSE 首条消息。
 *
 * 这是 QA-PLAN §8 前 6 步的自动化版本；后续 7–20 步（8 轮、共识、总结、回放一致性）
 * 在 FE-04/FE-05 落地后继续追加，不去改动本文件的步骤编号。
 *
 * 门控：`home` + `createForm` + 后端可达。缺任何一项都以明确原因 skip，
 * `E2E_STRICT=1` 时改为失败（门禁模式）。
 */

test.describe("主链路骨架 / 创建到首条发言", () => {
  test("首页 → 创建 → Lobby → confirm → SSE 收到首条 message.completed", async ({ page, api, backend, ui }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);
    requireCap(ui, "home");
    requireCap(ui, "createForm");

    const topic = uniqueTopic("AI 会不会让初级开发者失业？");

    // 1) 首页：能看到"发起新讨论"入口
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const newBtn = page.locator(SEL.newDiscussion).first();
    await expect(newBtn, "首页应有发起新讨论入口").toBeVisible();

    // 2) 进入创建页
    await newBtn.click();
    await expect(page.locator(SEL.createTopic).first(), "创建页应有议题输入框").toBeVisible();

    // 3) 填写议题并提交（专家人数用默认值：契约默认 4）
    await page.locator(SEL.createTopic).first().fill(topic);
    await page.locator(SEL.createSubmit).first().click();

    // 4) Lobby：1 主持 + N 专家；从 API 反查这条讨论，断言 UI 与后端一致
    await expect
      .poll(async () => page.locator(SEL.rosterMember).count(), {
        timeout: 40_000,
        message: "提交后应进入阵容页（roster-member 出现）",
      })
      .toBeGreaterThan(1);

    const list = await api.listDiscussions({ limit: 20 }, { timeoutMs: 10_000 });
    const items = (list.body as { items?: Array<{ id: string; topic: string; status: string }> } | null)?.items ?? [];
    const created = items.find((i) => i.topic === topic);
    expect(created, `后端列表里应能查到刚创建的议题「${topic}」`).toBeTruthy();
    const discussionId = created!.id;

    const detail = await api.getDiscussion(discussionId, { timeoutMs: 10_000 });
    expect(detail.status, "创建后应可就绪（ready）或已生成").toBeGreaterThanOrEqual(200);
    const detailBody = detail.body as DiscussionDetail;
    expect(detailBody.experts.length, "阵容应为 1 主持 + N 专家").toBeGreaterThanOrEqual(4);
    const hosts = detailBody.experts.filter((e) => e.role === "host");
    expect(hosts, "必须恰有 1 位主持人").toHaveLength(1);
    const hostId = hosts[0]!.id;
    expect(detailBody.experts.filter((e) => e.role === "expert").length, "专家人数 = expertCount")
      .toBe(detailBody.discussion.expertCount);

    // 5) confirm：点确认后进入演播厅
    const confirm = page.locator(SEL.rosterConfirm).first();
    await expect(confirm, "Lobby 应有确认按钮").toBeVisible();
    await confirm.click();

    // 部分实现会弹二次确认对话框；必须等它真的出现再点，否则会卡在 Lobby
    // （第一版实现里这里用 count() 立即判断，导致对话框刚渲染时被漏掉 → 页面停在 Lobby）
    const dialogAccept = page.locator(SEL.confirmDialogAccept).first();
    const dialogAppeared = await dialogAccept
      .waitFor({ state: "visible", timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (dialogAppeared) await dialogAccept.click();

    // 进入演播厅的硬信号是 transcript 容器出现，而不是 URL 变化（Lobby 也在 /d/:id 下）
    await expect
      .poll(async () => page.locator(SEL.transcriptList).count(), {
        timeout: 20_000,
        message: "确认后应进入演播厅（transcript 容器出现）",
      })
      .toBeGreaterThan(0);

    // 6) SSE 首条发言：用 Node 直连（不依赖 window.__qa.sse 是否已实现）
    const sse = await SseClient.connect(`/api/discussions/${discussionId}/stream`, {
      after: 0,
      timeoutMs: 12_000,
    });
    try {
      await sse.waitForEvent("stream.ready", { timeoutMs: 12_000 });
      // 首条 message.completed：正常 60s 内必到（mock 模式下通常 <10s）
      await sse.waitForEvent("message.completed", { timeoutMs: 60_000 });
      const frames = sse.frames;
      expect(frames.length, "SSE 应至少收到 ready + 一条 completed").toBeGreaterThan(1);

      // 6a) 事件顺序：turn.started 必须先于同 messageId 的 message.completed（06 §1.3）
      const completed = frames.find((f) => f.event === "message.completed")!;
      const msgId = (completed.data as { message?: { id?: string } })?.message?.id;
      expect(msgId, "message.completed 应带 message.id").toBeTruthy();
      const idxCompleted = frames.indexOf(completed);
      const idxStarted = frames.findIndex(
        (f) => f.event === "turn.started" && (f.data as { messageId?: string })?.messageId === msgId,
      );
      expect(idxStarted, `message ${msgId} 的 turn.started 必须先到达`).toBeGreaterThanOrEqual(0);
      expect(idxStarted, "turn.started 必须早于 message.completed").toBeLessThan(idxCompleted);

      // 6b) 首条发言者应是主持人，intent=opening（FR-06 / AR-02）
      const message = (completed.data as { message: Record<string, unknown> }).message;
      expect(message.intent, "首条发言应为 opening").toBe("opening");
      // 注意：服务端 expertId 是 `e_<uuid>`，不是 fixture 里的 `e_host`，所以用宿主 id 反查
      expect(message.expertId, "首条发言者应为主持人").toBe(hostId);
      expect(String(message.content ?? "").length, "首条发言不应为空").toBeGreaterThan(0);

      // 6c) 不串线：事件里的 discussionId 必须全部是本会话
      for (const f of frames) {
        const did = (f.data as { discussionId?: string })?.discussionId;
        if (did !== undefined) expect(did, "SSE 帧不应串到别的会话").toBe(discussionId);
      }
    } finally {
      sse.close("test-done");
      // 证据：把帧序列落到 artifacts，失败时可直接复查
      await test.info().attach("sse-frames.json", {
        body: JSON.stringify(sse.toEvidence(), null, 2),
        contentType: "application/json",
      });
      await test.info().attach("discussion-id.txt", { body: discussionId, contentType: "text/plain" });
    }
  });

  test("BUG-01 对照组：直接打开已结束讨论能正常渲染 transcript", async ({ page, api, backend }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);

    // 只用 ended 会话做对照：live/ready 的会话可能还没产生消息，会把"没消息"误判成"渲染失败"
    const list = await api.listDiscussions({ status: "ended", limit: 5 }, { timeoutMs: 10_000 });
    const items =
      ((list.body as { items?: Array<{ id: string; status: string }> } | null)?.items ?? []).filter(
        (i) => i.status === "ended",
      );
    test.skip(items.length === 0, "库里还没有已结束的讨论，无法做对照组");
    await page.goto(`/d/${items[0]!.id}`, { waitUntil: "domcontentloaded" });

    await expect
      .poll(async () => (await normalizeTranscript(page)).length, {
        timeout: 20_000,
        message: "直接打开已结束讨论时 transcript 应渲染出消息",
      })
      .toBeGreaterThanOrEqual(1);

    const rendered = await normalizeTranscript(page);
    const ids = rendered.map((m) => m.id).filter(Boolean);
    expect(new Set(ids).size, "同一 messageId 不应重复渲染").toBe(ids.length);
  });

  /**
   * 回归：应用内"创建 → 确认阵容 → 进入演播厅"后必须渲染出消息。
   *
   * 历史：2026-11-01 曾出现 live 空壳（`第 0 轮 · 0 条洞察`，专家栏与 transcript 全空），
   * 前端修复后本用例转为真实断言（原为 test.fail 标记）。
   */
  test("应用内确认阵容后，演播厅应渲染出消息", async ({ page, api, ui }) => {
    requireCap(ui, "home");
    requireCap(ui, "createForm");

    const topic = uniqueTopic("读大学选专业还要不要看就业率？");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator(SEL.newDiscussion).first().click();
    await page.locator(SEL.createTopic).first().fill(topic);
    await page.locator(SEL.createSubmit).first().click();
    await expect.poll(async () => page.locator(SEL.rosterMember).count(), { timeout: 40_000 }).toBeGreaterThan(1);

    await page.locator(SEL.rosterConfirm).first().click();
    const accept = page.locator(SEL.confirmDialogAccept).first();
    const appeared = await accept.waitFor({ state: "visible", timeout: 2500 }).then(() => true).catch(() => false);
    if (appeared) await accept.click();

    await expect
      .poll(async () => (await normalizeTranscript(page)).length, {
        timeout: 25_000,
        message: "应用内确认后 transcript 应渲染出消息",
      })
      .toBeGreaterThanOrEqual(1);

    // 用 URL 上的 discussionId 反查后端（不用列表匹配 topic，避免分页/排序干扰）
    const match = page.url().match(/\/d\/([0-9a-zA-Z_-]+)/);
    const discussionId = match?.[1];
    expect(discussionId, "演播厅 URL 应带 discussionId").toBeTruthy();
    const detail = await api.getDiscussion(discussionId!, { timeoutMs: 10_000 });
    expect(detail.status, "后端应能查到这条讨论").toBe(200);
    const body = detail.body as DiscussionDetail;
    expect(body.discussion.topic, "后端记录的议题应与提交的一致").toBe(topic);
    expect(body.messages.length, "后端应已有发言（证明不是前端自己造的）").toBeGreaterThanOrEqual(1);
  });

  test("API 侧创建幂等：同 clientRequestId 只产生 1 条讨论（06 §1.1）", async ({ api, backend }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);

    const clientRequestId = crypto.randomUUID();
    const topic = uniqueTopic("远程办公应该成为默认工作制吗？");

    const first = await api.createDiscussion({ topic, expertCount: 4, clientRequestId }, { timeoutMs: 30_000 });
    expect([200, 201], `首次创建 HTTP=${first.status}`).toContain(first.status);

    const second = await api.createDiscussion({ topic, expertCount: 4, clientRequestId }, { timeoutMs: 30_000 });
    expect(second.status, "重复请求应返回 200 而不是再建一条").toBe(200);

    const a = (first.body as { discussion?: { id?: string } })?.discussion?.id;
    const b = (second.body as { discussion?: { id?: string } })?.discussion?.id;
    expect(a, "首次创建应返回 discussionId").toBeTruthy();
    expect(b, "重复创建应返回同一条").toBe(a);

    const list = await api.listDiscussions({ limit: 50 }, { timeoutMs: 10_000 });
    const items = (list.body as { items?: Array<{ id: string; topic: string }> } | null)?.items ?? [];
    expect(items.filter((i) => i.topic === topic).length, "同 clientRequestId 不应产生重复讨论").toBe(1);
  });

  test("创建参数校验：短议题/超长议题/非法人数应 400（FR-02）", async ({ api, backend }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);

    const cases = [
      { name: "1 码点", body: { topic: "短", expertCount: 4 } },
      { name: "201 码点", body: { topic: "议".repeat(201), expertCount: 4 } },
      { name: "纯空白", body: { topic: "   ", expertCount: 4 } },
      { name: "人数 2", body: { topic: "专家人数越界测试", expertCount: 2 } },
      { name: "人数 7", body: { topic: "专家人数越界测试", expertCount: 7 } },
    ];

    for (const c of cases) {
      const res = await api.createDiscussion(
        { ...c.body, clientRequestId: crypto.randomUUID() },
        { timeoutMs: 20_000 },
      );
      expect(res.status, `${c.name} 应被拒绝`).toBe(400);
      const body = res.body as { error?: { code?: string } };
      expect(body.error?.code, `${c.name} 应返回 error.code`).toBeTruthy();
      expect(body.error?.code, `${c.name} 应为 VALIDATION_ERROR`).toBe("VALIDATION_ERROR");
    }
  });
});

/** 供报告引用：当前运行的目标地址。 */
test.afterAll(() => {
  // eslint-disable-next-line no-console
  console.log(`[qa] main-chain 目标：web=${env.baseURL} api=${env.apiURL}`);
});
