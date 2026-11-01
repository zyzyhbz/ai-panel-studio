import { expect, test } from "../helpers/fixtures";
import { assertClean } from "../helpers/scan";

/**
 * 冒烟 1：后端健康检查（契约 v1.0 §1.9）。
 *
 * 为什么它排在第一位：所有 E2E 的前置是"后端真的起来了、跑的是 mock、数据库接上了"。
 * 这三件事任何一件不成立，后面所有用例的失败原因都会指向错误的地方。
 */

test.describe("冒烟 / API 健康检查", () => {
  test("GET /api/health 返回 200 且契约字段齐全", async ({ api, backend }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）—— 先起 api: .\\scripts\\pnpm.ps1 dev`);

    const res = await api.health();
    expect(res.status, "health 必须 200").toBe(200);
    expect(res.durationMs, "health 响应应在 2s 内").toBeLessThan(2000);

    const body = res.body as Record<string, unknown>;
    // 契约 v1.0 §1.9 要求的字段（宁严勿松：缺字段会让后续用例全部误判）
    for (const field of ["status", "version", "llmMode", "dbReady", "activeSseCount", "uptimeMs", "rssBytes", "now"]) {
      expect(body, `health 缺字段 ${field}`).toHaveProperty(field);
    }
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(["mock", "real"]).toContain(body.llmMode);
    expect(typeof body.dbReady).toBe("boolean");
    expect(typeof body.activeSseCount).toBe("number");
    expect(typeof body.uptimeMs).toBe("number");
    expect(typeof body.rssBytes).toBe("number");
    expect(String(body.now)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // 自动化默认必须跑在 mock 模式：real 会调真实模型（烧钱 + 不可重复）。
    // 需要跑真实 thinking smoke 时显式设 E2E_ALLOW_REAL=1，并在报告里标明"这是 real 运行"。
    const allowReal = process.env.E2E_ALLOW_REAL === "1";
    if (allowReal) {
      expect(["mock", "real"], `llmMode 非法：${body.llmMode}`).toContain(body.llmMode);
      if (body.llmMode === "real") {
        test.info().annotations.push({ type: "real-mode", description: "E2E_ALLOW_REAL=1，本次为真实模型运行" });
      }
    } else {
      expect(
        body.llmMode,
        "自动化测试必须 LLM_MODE=mock（real 模式请用 E2E_ALLOW_REAL=1 显式开启）",
      ).toBe("mock");
    }

    // 响应体不能泄漏 Key / 堆栈（NFR-06）
    assertClean(JSON.stringify(body), "GET /api/health 响应体");
  });

  test("health 不应暴露 dbPath 等内部路径（06 §1.9 明确不返回）", async ({ api, backend }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);
    const res = await api.health();
    const body = res.body as Record<string, unknown>;
    expect(body, "health 不应返回 dbPath").not.toHaveProperty("dbPath");
    expect(JSON.stringify(body), "health 不应出现绝对路径").not.toMatch(/[A-Za-z]:\\/);
  });

  test("health.dbReady 应为 true，且 WAL 已开启（NFR-04）", async ({ api, backend }) => {
    test.skip(!backend.reachable, `后端不可达（${backend.error}）`);
    const res = await api.health();
    const body = res.body as Record<string, unknown>;
    expect(body.dbReady, "dbReady 必须为 true（BE-02 已接线）").toBe(true);
    // 后端 06 §1.9 扩展字段：schema 版本与 journal mode（后者用于断言 WAL）
    if (body.dbSchemaVersion !== undefined) {
      expect(typeof body.dbSchemaVersion, "dbSchemaVersion 应为数字").toBe("number");
    }
    if (body.dbJournalMode !== undefined) {
      expect(String(body.dbJournalMode).toLowerCase(), "SQLite 必须跑在 WAL 模式").toBe("wal");
    }
  });
});
