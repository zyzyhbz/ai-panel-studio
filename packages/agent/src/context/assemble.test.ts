import { describe, expect, it } from "vitest";
import {
  CONTEXT_BUDGET,
  FULL_WINDOW,
  assembleContext,
  personaLine,
  phaseFor,
  planFor,
  renderContextBlock,
} from "./assemble";
import { makeHistory, makeInsight, makeSnapshot } from "../test-support/factories";

describe("assembleContext 窗口", () => {
  it("最近 8 条保留全文，第 9 条起降为一行式", () => {
    const messages = makeHistory(
      Array.from({ length: 12 }, (_, i) => [
        `e_${(i % 4) + 1}`,
        "extend" as const,
        `第 ${i + 1} 条发言内容，用于测试窗口裁剪与降级。`,
      ]),
    );
    const snapshot = makeSnapshot({ messages, turnCount: messages.length });
    const bundle = assembleContext(snapshot, { purpose: "speech" });

    expect(bundle.includedMessageIds).toHaveLength(FULL_WINDOW + 4);
    expect(bundle.transcript.split("\n")).toHaveLength(FULL_WINDOW);
    expect(bundle.olderDigest.split("\n")).toHaveLength(4);
    // 新→旧
    expect(bundle.transcript.startsWith("[m_12]")).toBe(true);
  });

  it("没有发言时给出空现场占位，不抛错", () => {
    const bundle = assembleContext(makeSnapshot(), { purpose: "decision" });
    expect(bundle.transcript).toBe("");
    expect(renderContextBlock(bundle)).toContain("还没有人发言");
  });
});

describe("assembleContext 预算", () => {
  it("长会话不会超过预算（含固定段）", () => {
    const messages = makeHistory(
      Array.from({ length: 40 }, (_, i) => [
        `e_${(i % 4) + 1}`,
        "rebut" as const,
        `这是一条比较长的发言，用来把上下文撑大，序号 ${i + 1}，内容里还有一些解释性的补充说明。`,
      ]),
    );
    const insights = Array.from({ length: 12 }, (_, i) =>
      makeInsight(`i_${i}`, i % 3 === 0 ? "consensus" : "divergence", `第 ${i} 条共识或分歧的结论`, [
        "m_1",
        "m_2",
      ]),
    );
    const snapshot = makeSnapshot({ messages, insights, turnCount: messages.length });

    for (const purpose of ["decision", "speech", "insight", "summary"] as const) {
      const bundle = assembleContext(snapshot, { purpose });
      expect(bundle.estimatedTokens).toBeLessThanOrEqual(CONTEXT_BUDGET[purpose] + 200);
      // 窗口是硬的：无论多少条历史，最多 8 全文 + 8 一行式
      expect(bundle.includedMessageIds.length).toBeLessThanOrEqual(FULL_WINDOW + 8);
      // 至少保留最新一条，否则模型会失忆
      expect(bundle.includedMessageIds).toContain("m_40");
    }
  });

  it("上下文里只含本会话消息（不串会话）", () => {
    const a = makeSnapshot({ discussionId: "d_a" });
    const b = makeSnapshot({ discussionId: "d_b" });
    const bundle = assembleContext(a, { purpose: "decision" });
    expect(renderContextBlock(bundle)).not.toContain(b.discussionId);
    expect(bundle.includedMessageIds).toEqual([]);
  });
});

describe("planFor / phaseFor", () => {
  it("第 1 轮是开场，到覆盖保底进入预收（是否收由饱和决定）", () => {
    expect(phaseFor(1, 12)).toBe("open");
    expect(phaseFor(4, 12)).toBe("expand");
    expect(phaseFor(8, 12)).toBe("clash");
    expect(phaseFor(11, 12)).toBe("preclose");
    expect(phaseFor(12, 12)).toBe("preclose");
  });

  it("计划轮次不再等于『必须收尾』", () => {
    const snapshot = makeSnapshot({ turnCount: 9, plannedTurns: 10, maxTurns: 36 });
    const plan = planFor(snapshot);
    expect(plan.turnIndex).toBe(10);
    expect(plan.mustClose).toBe(false);
    expect(plan.phase).toBe("preclose");
    expect(planFor(snapshot, true).mustClose).toBe(true);
  });
});

describe("personaLine", () => {
  it("包含 id/姓名/立场轴/极性，可直接被 mock 与模型读取", () => {
    const snapshot = makeSnapshot();
    const line = personaLine(snapshot.experts[1]!);
    expect(line).toContain("id=e_1");
    expect(line).toContain("周明");
    expect(line).toContain("岗位替代 vs 岗位重构");
    expect(line).toContain("支持");
  });
});
