import { describe, expect, it } from "vitest";
import { buildEligibility, consecutiveTail, evaluateClose, hostQuotaOf } from "./eligibility";
import { sanitizeDecision, validateDecision } from "./decision";
import { selectFallbackSpeaker } from "./fallback";
import { normalizeRoster } from "./roster";
import { validateSpeech } from "./speech";
import { normalizeInsights, summarizeInsightRejections } from "./insight";
import type { TurnDecision } from "../core/types";
import { makeHistory, makeInsight, makeMessage, makeSnapshot } from "../test-support/factories";
import type { RosterDraft } from "../core/types";

describe("buildEligibility", () => {
  it("第 1 轮强制主持人开场，且只能选他", () => {
    const eligibility = buildEligibility(makeSnapshot());
    expect(eligibility.turnIndex).toBe(1);
    expect(eligibility.forcedReason).toBe("opening");
    expect(eligibility.forcedSpeakerId).toBe("e_host");
    expect(eligibility.allowedSpeakers.map((s) => s.id)).toEqual(["e_host"]);
  });

  it("同一专家连续 2 次后被剔除", () => {
    const messages = makeHistory([
      ["e_1", "opening", "先抛个判断。"],
      ["e_1", "extend", "我再补一句。"],
    ]);
    const snapshot = makeSnapshot({ messages, turnCount: 2 });
    const eligibility = buildEligibility(snapshot);

    expect(consecutiveTail(snapshot, "e_1")).toBe(2);
    expect(eligibility.allowedSpeakers.map((s) => s.id)).not.toContain("e_1");
    expect(eligibility.exempted.some((e) => e.id === "e_1")).toBe(true);
  });

  it("有人一次没发言时，过了半场强制优先", () => {
    const messages = makeHistory([
      ["e_host", "opening", "今天先不谈结论。"],
      ["e_1", "extend", "我说第一点。"],
      ["e_2", "rebut", "我不同意这点。"],
    ]);
    const snapshot = makeSnapshot({ messages, turnCount: 3 });
    const eligibility = buildEligibility(snapshot);

    expect(eligibility.turnIndex).toBe(4);
    expect(eligibility.neverSpoken.length).toBe(2);
    expect(eligibility.forcedReason).toBe("coverage");
    expect(eligibility.allowedSpeakers).toHaveLength(1);
  });

  it("主持人配额用满后不再出现在候选集", () => {
    const messages = makeHistory([
      ["e_host", "opening", "开场。"],
      ["e_1", "extend", "一。"],
      ["e_host", "probe", "追问。"],
      ["e_2", "rebut", "二。"],
      ["e_host", "mediate", "串联。"],
      ["e_3", "extend", "三。"],
      ["e_host", "summary", "收尾。"],
    ]);
    const snapshot = makeSnapshot({ messages, turnCount: 7 });
    const eligibility = buildEligibility(snapshot);

    expect(eligibility.host.used).toBe(4);
    expect(eligibility.allowedSpeakers.map((s) => s.id)).not.toContain("e_host");
  });

  it("到达硬上限必须收尾，候选只剩主持人", () => {
    const messages = makeHistory(
      Array.from({ length: 14 }, (_, i) => [
        `e_${(i % 4) + 1}`,
        "extend" as const,
        `第 ${i + 1} 条。`,
      ]),
    );
    const snapshot = makeSnapshot({ messages, turnCount: 14 });
    const eligibility = buildEligibility(snapshot);

    expect(eligibility.mustClose).toBe(true);
    expect(eligibility.closeReason).toBe("hard_cap");
    expect(eligibility.allowedSpeakers.map((s) => s.id)).toEqual(["e_host"]);
  });

  it("到计划轮次且有覆盖与洞察时按 planned_reached 收尾", () => {
    const messages = makeHistory(
      Array.from({ length: 11 }, (_, i) => [
        `e_${(i % 4) + 1}`,
        "extend" as const,
        `第 ${i + 1} 条。`,
      ]),
    );
    const snapshot = makeSnapshot({
      messages,
      turnCount: 11,
      insights: [
        makeInsight("i_1", "consensus", "双方都认为职责会变", ["m_1", "m_2"]),
        makeInsight("i_2", "divergence", "压缩还是升级", ["m_2", "m_3"]),
      ],
    });
    const eligibility = buildEligibility(snapshot);
    expect(eligibility.closeReason).toBe("planned_reached");
  });

  it("hostQuotaOf 统计各分型次数", () => {
    const messages = makeHistory([
      ["e_host", "opening", "开场。"],
      ["e_host", "probe", "追问。"],
      ["e_host", "mediate", "串联。"],
    ]);
    const quota = hostQuotaOf(makeSnapshot({ messages }), makeSnapshot().experts[0]);
    expect(quota).toMatchObject({ used: 3, openingDone: true, probeUsed: 1, mediateUsed: 1 });
  });

  it("evaluateClose 在计划轮次前不收束", () => {
    const snapshot = makeSnapshot({ turnCount: 5 });
    expect(evaluateClose(snapshot, 6)).toBeUndefined();
    expect(evaluateClose(snapshot, 12)).toBe("planned_reached");
    expect(evaluateClose(snapshot, 15)).toBe("hard_cap");
  });
});

describe("decision 校验与修复", () => {
  const snapshot = makeSnapshot({
    messages: makeHistory([
      ["e_host", "opening", "开场。"],
      ["e_1", "extend", "我的判断是替代任务。"],
      ["e_2", "rebut", "我不同意，人被挤出去了。"],
    ]),
    turnCount: 3,
  });
  const eligibility = buildEligibility(snapshot);

  it("选不在候选集里的人 → 修复为合法人", () => {
    const decision: TurnDecision = {
      speakerId: "e_ghost",
      intent: "rebut",
      turnFocus: "岗位结构",
    };
    const result = sanitizeDecision(decision, snapshot, eligibility);
    expect(eligibility.allowedSpeakers.map((s) => s.id)).toContain(result.decision.speakerId);
    expect(result.repaired).toBe(true);
  });

  it("未到收尾轮却给 summary → 降级为 extend", () => {
    const decision: TurnDecision = {
      speakerId: eligibility.allowedSpeakers[0]!.id,
      intent: "summary",
      turnFocus: "岗位结构",
    };
    const result = sanitizeDecision(decision, snapshot, eligibility);
    expect(result.decision.intent).toBe("extend");
  });

  it("targetMessageId 指向自己 → 移除并降级", () => {
    const spoken = makeSnapshot({
      messages: makeHistory([
        ["e_host", "opening", "开场。"],
        ["e_1", "extend", "甲。"],
        ["e_2", "rebut", "乙。"],
        ["e_3", "extend", "丙。"],
        ["e_4", "extend", "丁。"],
      ]),
      turnCount: 5,
    });
    const spokenEligibility = buildEligibility(spoken);
    const own = spoken.messages.find((m) => m.expertId === "e_1")!;
    const result = sanitizeDecision(
      { speakerId: "e_1", intent: "rebut", turnFocus: "岗位结构", targetMessageId: own.id },
      spoken,
      spokenEligibility,
    );
    expect(result.decision.targetMessageId).toBeUndefined();
    expect(result.decision.intent).toBe("extend");
  });

  it("turnFocus 写了思考过程 → 被替换", () => {
    const result = sanitizeDecision(
      {
        speakerId: eligibility.allowedSpeakers[0]!.id,
        intent: "extend",
        turnFocus: "我认为先分析一下岗位",
      },
      snapshot,
      eligibility,
    );
    expect(result.decision.turnFocus).not.toContain("我认为");
    expect(result.repaired).toBe(true);
  });

  it("validateDecision 对合法决策返回 ok", () => {
    const speakerId = eligibility.allowedSpeakers[0]!.id;
    const other = snapshot.messages.find((m) => m.expertId !== speakerId)!;
    const decision: TurnDecision = {
      speakerId,
      intent: "support",
      turnFocus: "岗位结构",
      targetMessageId: other.id,
    };
    expect(validateDecision(decision, snapshot, eligibility).ok).toBe(true);
  });

  it("fallback 永远返回候选集内的人", () => {
    const { decision } = selectFallbackSpeaker(snapshot, eligibility);
    expect(eligibility.allowedSpeakers.map((s) => s.id)).toContain(decision.speakerId);
    expect(decision.turnFocus.length).toBeGreaterThanOrEqual(2);
  });
});

describe("normalizeRoster", () => {
  const draft: RosterDraft = {
    host: {
      name: "林致远",
      profession: "科技主持人",
      title: "资深圆桌主持",
      stance: "中立，负责追问、串联与收尾",
      stanceAxis: "节奏与交锋",
      polarity: "neutral",
      focusArea: "开场与节奏",
      colorKey: "mist",
    },
    experts: [
      {
        name: "周明",
        profession: "软件工程师",
        title: "技术负责人",
        stance: "AI 重构岗位",
        stanceAxis: "替代 vs 重构",
        polarity: "support",
        focusArea: "工程",
        colorKey: "ocean",
      },
      {
        name: "许澜",
        profession: "心理学研究者",
        title: "副教授",
        stance: "人的适应被高估",
        stanceAxis: "替代 vs 重构",
        polarity: "oppose",
        focusArea: "人",
        colorKey: "ocean", // 故意重复
      },
      {
        name: "周明", // 故意重名
        profession: "经济学者",
        title: "研究员",
        stance: "先看供需",
        stanceAxis: "效率 vs 分配",
        polarity: "neutral",
        focusArea: "成本",
        color: "#123456",
      },
      {
        name: "顾行舟",
        profession: "创业者",
        title: "创始人",
        stance: "小团队会替代初级层",
        stanceAxis: "效率 vs 分配",
        polarity: "strong_support",
        focusArea: "组织",
        colorKey: "bronze",
      },
    ],
  };

  it("解析 colorKey 与 hex，去重颜色与姓名，主持人固定中性色", () => {
    const result = normalizeRoster(draft, { expertCount: 4 });
    expect(result.host.color).toBe("#D9D9D9");
    expect(new Set(result.experts.map((e) => e.color)).size).toBe(4);
    expect(new Set([result.host.name, ...result.experts.map((e) => e.name)]).size).toBe(5);
    expect(result.experts[2]?.color).toBe("#123456");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("专家不足时用模板补位并标 degraded", () => {
    const result = normalizeRoster(
      { host: draft.host, experts: draft.experts.slice(0, 2) },
      { expertCount: 4 },
    );
    expect(result.experts).toHaveLength(4);
    expect(result.degraded).toBe(true);
  });

  it("缺反对侧时给出 needsRetry", () => {
    const allSupport = {
      host: draft.host,
      experts: draft.experts.map((e) => ({ ...e, polarity: "support" as const })),
    };
    const result = normalizeRoster(allSupport, { expertCount: 4 });
    expect(result.needsRetry).toBe(true);
    expect(result.warnings.join()).toContain("反对");
  });
});

describe("validateSpeech", () => {
  it("超过 2 句被截断", () => {
    const check = validateSpeech("第一句。第二句。第三句。");
    expect(check.sentenceCount).toBeLessThanOrEqual(2);
    expect(check.text).not.toContain("第三句");
    expect(check.reasons).toContain("too_many_sentences");
  });

  it("超过 120 字被截断", () => {
    const long = `${"很长的发言内容，".repeat(20)}。`;
    const check = validateSpeech(long);
    expect(check.charCount).toBeLessThanOrEqual(120);
  });

  it("主持人上限 60 字", () => {
    const long = "主持人这句话要短一些，不能长篇大论地讲道理，否则就会变成讲课而不是主持。";
    const check = validateSpeech(long, { isHost: true });
    expect(check.charCount).toBeLessThanOrEqual(61); // 60 + 省略号
  });

  it("与最近发言高度重复时判为 repetitive", () => {
    const recent = [makeMessage("m_1", "e_1", 1, "extend", "AI 先替代的是任务，不是人。")];
    const check = validateSpeech("AI 先替代的是任务，不是人。", { recent });
    expect(check.repeated).toBe(true);
    expect(check.ok).toBe(false);
  });

  it("去掉“我是 AI”这类元叙述", () => {
    const check = validateSpeech("作为 AI，我认为这件事要分开看。");
    expect(check.reasons).toContain("meta");
    expect(check.text).not.toContain("作为 AI");
  });

  it("空输出判为不 ok", () => {
    const check = validateSpeech("   ");
    expect(check.ok).toBe(false);
    expect(check.reasons).toContain("empty");
  });
});

describe("normalizeInsights", () => {
  const snapshot = makeSnapshot({
    messages: makeHistory([
      ["e_host", "opening", "开场。"],
      ["e_1", "extend", "岗位职责会被重构，但人数没少。"],
      ["e_2", "rebut", "初级岗位少了 30%，这是压缩不是重构。"],
      ["e_3", "extend", "再培训成本没人算过。"],
    ]),
    turnCount: 4,
    insights: [makeInsight("i_old", "consensus", "双方都认为职责会变化", ["m_2", "m_3"])],
  });

  it("证据 id 不存在 → 整条丢弃", () => {
    const result = normalizeInsights(
      [{ type: "consensus", content: "双方都认为职责会变", evidenceMessageIds: ["m_404"] }],
      snapshot,
    );
    expect(result.insights).toEqual([]);
    expect(result.rejected[0]?.reason).toBe("evidence_unknown");
  });

  it("共识只有单人证据 → 丢弃", () => {
    const result = normalizeInsights(
      [{ type: "consensus", content: "双方都认为职责会变", evidenceMessageIds: ["m_2", "m_2"] }],
      snapshot,
    );
    expect(result.insights).toEqual([]);
    expect(result.rejected[0]?.reason).toBe("need_two_speakers");
  });

  it("数字无法在证据里溯源 → 丢弃", () => {
    const result = normalizeInsights(
      [{ type: "divergence", content: "压缩幅度是 60% 还是 30%", evidenceMessageIds: ["m_2", "m_3"] }],
      snapshot,
    );
    expect(result.rejected[0]?.reason).toContain("number_unsourced");
  });

  it("合法分歧被接受，id 稳定且证据按轮次排序", () => {
    const result = normalizeInsights(
      [
        {
          type: "divergence",
          content: "分歧在于这是压缩还是重构",
          evidenceMessageIds: ["m_3", "m_2"],
        },
      ],
      snapshot,
      { turnIndex: 5 },
    );
    expect(result.insights).toHaveLength(1);
    expect(result.insights[0]?.evidenceMessageIds).toEqual(["m_2", "m_3"]);
    expect(result.insights[0]?.firstSeenTurn).toBe(5);
    expect(result.insights[0]?.id).toMatch(/^i_/);
  });

  it("与已有条目近似时合并不新增 id", () => {
    const result = normalizeInsights(
      [{ type: "consensus", content: "双方都认为职责会变化", evidenceMessageIds: ["m_2", "m_3", "m_4"] }],
      snapshot,
    );
    expect(result.insights[0]?.id).toBe("i_old");
    expect(result.added).toBe(0);
  });

  it("第一人称结论被丢弃", () => {
    const result = normalizeInsights(
      [{ type: "open_question", content: "我认为这个问题还没解决", evidenceMessageIds: ["m_4"] }],
      snapshot,
    );
    expect(result.rejected[0]?.reason).toBe("first_person");
  });

  it("拒绝原因可压成一行给日志（洞察恒为 0 时排查用）", () => {
    const result = normalizeInsights(
      [
        { type: "consensus", content: "大家都觉得要理性", evidenceMessageIds: ["m_404"] },
        { type: "consensus", content: "双方都认为职责会变", evidenceMessageIds: ["m_2"] },
      ],
      snapshot,
    );
    const summary = summarizeInsightRejections(result.rejected);
    expect(summary).toContain("evidence_unknown");
    expect(summary).toContain("need_two_speakers");
  });
});
