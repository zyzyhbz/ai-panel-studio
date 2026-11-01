import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { env } from "../helpers/env";

/**
 * 契约用例：fixtures 自检（不依赖被测应用，永远可跑）。
 *
 * 分工：
 * - 本 spec = 快速结构检查（JSON 合法、议题数量、kind/场景覆盖、事件不变式）；
 * - `e2e/tools/validate-fixtures.mjs` = 全量字段级校验（颜色唯一、极性 >=3、码点上限…），
 *   作为门禁脚本单独跑，输出可归档的 JSON 报告。
 *
 * 为什么不全塞进 spec：全量校验要读 37 个文件并做语义断言，放进 Playwright 会让
 * "应用没起时连 fixtures 都验不了"；拆开后二者互不阻塞。
 */

const FIXTURES = env.fixturesDir;

async function walkJson(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkJson(full)));
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

test.describe("契约 / fixtures 结构自检", () => {
  test("全部 JSON 可解析且带 $schema", async () => {
    const files = await walkJson(FIXTURES);
    expect(files.length, "fixtures 文件数应 >= 30").toBeGreaterThanOrEqual(30);

    const bad: string[] = [];
    for (const file of files) {
      const rel = path.relative(FIXTURES, file).replace(/\\/g, "/");
      try {
        const doc = JSON.parse(await readFile(file, "utf8"));
        if (typeof doc.$schema !== "string") bad.push(`${rel}: 缺 $schema`);
      } catch (e) {
        bad.push(`${rel}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    expect(bad, `无法解析的 fixture：\n${bad.join("\n")}`).toHaveLength(0);
  });

  test("5 个议题且 plannedTurns/maxTurns 符合 06 §1.6 公式", async () => {
    const doc = JSON.parse(await readFile(path.join(FIXTURES, "topics.json"), "utf8"));
    expect(doc.topics.length).toBeGreaterThanOrEqual(5);

    for (const t of doc.topics) {
      const planned = Math.min(12, Math.max(8, 4 + 2 * t.expertCount));
      const max = Math.min(14, planned + 2);
      expect(t.plannedTurns, `${t.id} plannedTurns`).toBe(planned);
      expect(t.maxTurns, `${t.id} maxTurns`).toBe(max);
      expect(t.marker?.length, `${t.id} 需要 marker 用于串线检测`).toBeGreaterThanOrEqual(2);
      expect(t.rosterFixture).toMatch(/^llm\/roster\//);
    }
  });

  test("每个 kind 都有正常 fixture，且 9 种场景全覆盖", async () => {
    const files = await walkJson(path.join(FIXTURES, "llm"));
    const docs = await Promise.all(
      files.map(async (f) => JSON.parse(await readFile(f, "utf8")) as Record<string, unknown>),
    );
    const fixtures = docs.filter((d) => d.$schema === "qa/llm-fixture@1");

    for (const kind of ["roster", "decision", "speech", "consensus", "summary"]) {
      const ok = fixtures.filter((d) => d.kind === kind && d.negative === false);
      expect(ok.length, `kind=${kind} 缺少正常 fixture`).toBeGreaterThan(0);
    }

    const scenarios = new Set(fixtures.map((d) => d.scenario as string));
    if (docs.some((d) => d.$schema === "qa/mixed-plan@1")) scenarios.add("mixed");
    for (const s of ["normal", "slow", "timeout", "invalid-json", "empty", "duplicate", "runaway", "long", "mixed"]) {
      expect(scenarios.has(s), `scenario=${s} 没有 fixture 覆盖`).toBe(true);
    }

    const negatives = fixtures.filter((d) => d.negative === true);
    expect(negatives.length, "负例资产应 >= 8（坏 JSON/空/超长/重复/无依据/轮转/失控…）")
      .toBeGreaterThanOrEqual(8);
  });

  test("事件 fixture 满足 06 §1.3 的 turn 终态不变式", async () => {
    const main = JSON.parse(
      await readFile(path.join(FIXTURES, "events", "main-flow.json"), "utf8"),
    ) as { events: { type: string; seq: number }[] };

    const starts = main.events.filter((e) => e.type === "turn.started").length;
    const terminals = main.events.filter((e) => ["message.completed", "turn.aborted"].includes(e.type)).length;
    expect(starts, "每个 turn.started 必须有终态").toBe(terminals);
    expect(main.events.filter((e) => e.type === "discussion.ended")).toHaveLength(1);
    expect(main.events.at(-1)?.type).toBe("discussion.ended");
    expect(main.events.map((e) => e.seq)).toEqual(
      main.events.map((_, i) => i + 1).slice(0, main.events.length),
    );
  });
});
