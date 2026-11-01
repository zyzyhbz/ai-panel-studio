import { expect, test } from "../helpers/fixtures";
import { SEL } from "../helpers/selectors";
import { requireCap, uniqueTopic } from "../helpers/fixtures";

/**
 * 冒烟 3：创建表单校验（FR-02）。
 *
 * 实测行为：表单在议题为空/过短时**禁用**提交按钮（比"可点但报错"更好的交互），
 * 因此这里的断言写成"拦截方式可以是禁用或报错"，
 * 但"合法议题必须可提交"是硬断言。
 */

test.describe("冒烟 / 创建表单", () => {
  test("议题为空或过短时不能提交；合法议题可提交（2–200 码点）", async ({ page, ui }) => {
    requireCap(ui, "createForm");

    await page.goto("/new", { waitUntil: "domcontentloaded" });

    const topic = page.locator(SEL.createTopic).first();
    const submit = page.locator(SEL.createSubmit).first();
    await expect(topic, "议题输入框应存在").toBeVisible();
    await expect(submit, "提交按钮应存在").toBeVisible();

    /** 返回"当前是否被拦住"：按钮禁用 或 点击后出现错误/停在原页。 */
    async function blocked(): Promise<boolean> {
      if (await submit.isDisabled()) return true;
      const urlBefore = page.url();
      await submit.click({ trial: false }).catch(() => undefined);
      await page.waitForTimeout(250);
      const hasError = (await page.locator(SEL.createError).count()) > 0;
      return hasError || page.url() === urlBefore;
    }

    // 1) 空议题
    expect(await blocked(), "空议题不应能提交").toBe(true);

    // 2) 1 码点（契约下限 2）
    await topic.fill("短");
    expect(await blocked(), "1 码点不应能提交").toBe(true);

    // 3) 纯空白
    await topic.fill("   ");
    expect(await blocked(), "纯空白不应能提交").toBe(true);

    // 4) 200 码点（上限）：应可提交
    const atLimit = "议题".repeat(100);
    await topic.fill(atLimit);
    await expect(submit, "200 码点应允许提交").toBeEnabled();
    const counter = page.locator(SEL.createTopicCounter).first();
    if ((await counter.count()) > 0) {
      expect((await counter.textContent()) ?? "", "字数计数应显示 200").toMatch(/200/);
    }

    // 5) 201 码点：要么被 maxlength 截断到 200，要么提交被拦
    await topic.fill("议".repeat(201));
    const actualLen = (await topic.inputValue()).length;
    if (actualLen > 200) {
      expect(await blocked(), "201 码点不应能提交").toBe(true);
    } else {
      expect(actualLen, "超长输入应被截断到 200").toBeLessThanOrEqual(200);
    }
  });

  test("合法议题可提交并进入 generating/ready", async ({ page, ui }) => {
    requireCap(ui, "createForm");

    await page.goto("/new", { waitUntil: "domcontentloaded" });
    await page.locator(SEL.createTopic).first().fill(uniqueTopic("远程办公应该成为默认工作制吗？"));
    await page.locator(SEL.createSubmit).first().click();

    await expect
      .poll(
        async () => {
          if (/\/d\/[^/]+/.test(page.url())) return "routed";
          if ((await page.locator(SEL.rosterPanel).count()) > 0) return "roster";
          if ((await page.locator(SEL.createGenerating).count()) > 0) return "generating";
          return "idle";
        },
        { timeout: 45_000, message: "提交后应进入 generating / ready / 演播厅" },
      )
      .not.toBe("idle");
  });
});
