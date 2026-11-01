import { describe, expect, it } from "vitest";
import { buildRosterPrompt } from "./roster";
import { buildDecisionPrompt } from "./decision";
import { buildSpeechPrompt } from "./speech";
import { buildInsightPrompt } from "./insight";
import { buildSummaryPrompt } from "./summary";
import { CONTEXT_BUDGET } from "../context/assemble";
import { buildEligibility } from "../policy/eligibility";
import { TOPIC_FIXTURES } from "../llm/fixtures";
import { makeHistory, makeSnapshot } from "../test-support/factories";

/**
 * 五类 builder 的结构契约：
 * - kind / responseFormat / 参数必须对；
 * - prompt 里必须真的带上守卫算出来的候选集与窗口 id；
 * - 输入预算必须落在上下文预算内。
 * 这些是"prompt 与代码不同步"最早暴露的地方。
 */

const snapshot = makeSnapshot({
  messages: makeHistory([
    ["e_host", "opening", "今天先不谈结论，先谈岗位到底在变什么。"],
    ["e_1", "extend", "被替掉的是写样板代码的任务，不是这个人。"],
    ["e_2", "rebut", "你算的是产出，我算的是人，转型期的时间成本没人付。"],
    ["e_3", "extend", "历史上每次工具升级，短期都有一批人被挤出去。"],
  ]),
  turnCount: 4,
  insights: [
    {
      id: "i_old",
      type: "divergence",
      content: "分歧在于这是压缩还是重构",
      evidenceMessageIds: ["m_2", "m_3"],
      firstSeenTurn: 2,
    },
  ],
});

const eligibility = buildEligibility(snapshot);

describe("buildRosterPrompt", () => {
  const spec = buildRosterPrompt({ topic: TOPIC_FIXTURES[0]!.topic, expertCount: 4 });

  it("是 json 调用，参数符合 AR-10", () => {
    expect(spec.kind).toBe("roster");
    expect(spec.responseFormat).toBe("json_object");
    expect(spec.temperature).toBeGreaterThan(0.5);
    expect(spec.maxOutputTokens).toBe(1200);
    expect(spec.thinking).toBe("disabled");
  });

  it("包含规模、四维差异与调色板", () => {
    expect(spec.user).toContain("4 位专家");
    expect(spec.user).toContain("stanceAxis");
    expect(spec.user).toContain("colorKey");
    expect(spec.user).toContain("oppose");
  });

  it("修复重试会降温（减少发散）", () => {
    const retry = buildRosterPrompt({
      topic: "t",
      expertCount: 4,
      repairHint: "stanceAxis 重复",
    });
    expect(retry.temperature).toBeLessThan(spec.temperature);
    expect(retry.user).toContain("stanceAxis 重复");
  });
});

describe("buildDecisionPrompt", () => {
  const spec = buildDecisionPrompt({ snapshot, eligibility });

  it("是 json 调用且预算受控", () => {
    expect(spec.kind).toBe("decision");
    expect(spec.responseFormat).toBe("json_object");
    expect(spec.estimatedInputTokens).toBeGreaterThan(0);
    expect(spec.estimatedInputTokens).toBeLessThanOrEqual(CONTEXT_BUDGET.decision + 150);
  });

  it("allowed_speakers 块只包含守卫允许的人", () => {
    const block = spec.user.split("<allowed_speakers>")[1]?.split("</allowed_speakers>")[0] ?? "";
    const allowed = eligibility.allowedSpeakers.map((s) => s.id);
    const idsInBlock = [...block.matchAll(/id=([\w-]+)/g)].map((m) => m[1]!);
    expect(idsInBlock.length).toBeGreaterThan(0);
    expect(new Set(idsInBlock)).toEqual(new Set(allowed));
  });

  it("带上当前共识/分歧与窗口 id", () => {
    expect(spec.user).toContain("i_old");
    expect(spec.user).toContain("[m_3]");
    expect(spec.includedMessageIds).toContain("m_3");
  });

  it("收尾轮会明确写 mustClose=true", () => {
    const closing = makeSnapshot({
      messages: makeHistory(
        Array.from({ length: 11 }, (_, i) => [`e_${(i % 4) + 1}`, "extend" as const, `第 ${i} 条。`]),
      ),
      turnCount: 11,
    });
    const closingEligibility = buildEligibility(closing);
    const closingSpec = buildDecisionPrompt({ snapshot: closing, eligibility: closingEligibility });
    expect(closingEligibility.mustClose).toBe(true);
    expect(closingSpec.user).toContain("现在必须收尾：true");
  });
});

describe("buildSpeechPrompt", () => {
  const speaker = snapshot.experts[2]!;
  const spec = buildSpeechPrompt({
    snapshot,
    decision: {
      speakerId: speaker.id,
      intent: "rebut",
      turnFocus: "岗位结构的变化速度",
      targetMessageId: "m_3",
    },
    speaker,
  });

  it("是纯文本调用（不套 JSON）", () => {
    expect(spec.kind).toBe("speech");
    expect(spec.responseFormat).toBe("text");
    expect(spec.user).toContain("直接输出");
  });

  it("带上人设、意图、关注点与被回应原话", () => {
    expect(spec.system).toContain(speaker.name);
    expect(spec.system).toContain(speaker.stance);
    expect(spec.user).toContain("反驳");
    expect(spec.user).toContain("岗位结构的变化速度");
    expect(spec.user).toContain("你算的是产出");
  });

  it("主持人变体给出更短的上限", () => {
    const host = snapshot.experts[0]!;
    const hostSpec = buildSpeechPrompt({
      snapshot,
      decision: { speakerId: host.id, intent: "probe", turnFocus: "把说法落到例子", targetMessageId: "m_3" },
      speaker: host,
    });
    expect(hostSpec.user).toContain("不超过 60 字");
    expect(hostSpec.user).toContain("追问");
  });
});

describe("buildInsightPrompt", () => {
  const spec = buildInsightPrompt({ snapshot });

  it("是 json 调用，带上可用 id 与已有台账", () => {
    expect(spec.kind).toBe("insight");
    expect(spec.responseFormat).toBe("json_object");
    expect(spec.user).toContain("i_old");
    expect(spec.user).toContain("m_2");
    expect(spec.user).toContain("consensus");
  });

  it("明确空快照合法（避免模型硬凑）", () => {
    expect(spec.user).toContain("空快照");
  });

  it("maxNew 会写进 prompt", () => {
    const custom = buildInsightPrompt({ snapshot, maxNew: 1 });
    expect(custom.user).toContain("最多新增 1 条");
  });
});

describe("buildSummaryPrompt", () => {
  const spec = buildSummaryPrompt({ snapshot, closingLine: "这场先把分歧标出来。" });

  it("是纯文本三段，不要求 JSON", () => {
    expect(spec.kind).toBe("summary");
    expect(spec.responseFormat).toBe("text");
    expect(spec.user).toContain("3 段");
    expect(spec.system).not.toContain('{"insights"');
  });

  it("以最终快照为准，并包含收尾发言避免重复", () => {
    expect(spec.user).toContain("分歧在于这是压缩还是重构");
    expect(spec.user).toContain("这场先把分歧标出来。");
  });
});
