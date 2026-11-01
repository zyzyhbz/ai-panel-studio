import { describe, expect, it } from "vitest";
import { buildEligibility, consecutiveTail, evaluateClose, hostQuotaOf } from "./eligibility";
import { sanitizeDecision, validateDecision } from "./decision";
import { selectFallbackSpeaker } from "./fallback";
import { normalizeRoster } from "./roster";
import { validateSpeech } from "./speech";
import { normalizeInsights, summarizeInsightRejections } from "./insight";
import { buildDebateMap, type Saturation } from "../context/debate-map";
import { coverageFloorFor } from "../core/rounds";
import type { RosterDraft, TurnDecision } from "../core/types";
import { makeHistory, makeInsight, makeMessage, makeSnapshot } from "../test-support/factories";

/** 造一个"已收敛"的饱和结构，便于单测各分支 */
function sat(overrides: Partial<Saturation> = {}): Saturation {
  return {
    ready: true,
    reasons: [],
    openChallengeCount: 0,
    blockingChallengeCount: 0,
    acceptedUnresolved: [],
    newClaimTurns: 0,
    expertsSpokenTwice: 4,
    unresolvedTensions: 0,
    newTensionCount: 0,
    hostPressed: true,
    ...overrides,
  };
}

describe("coverageFloor（覆盖保底，不是目标）", () => {
  it("2n+2，上限 12", () => {
    expect(coverageFloorFor(3)).toBe(8);
    expect(coverageFloorFor(4)).toBe(10);
    expect(coverageFloorFor(5)).toBe(12);
    expect(coverageFloorFor(6)).toBe(12);
  });
});

describe("buildEligibility：轮次与收束", () => {
  it("第 1 轮强制主持人开场，且只能选他", () => {
    const eligibility = buildEligibility(makeSnapshot());
    expect(eligibility.turnIndex).toBe(1);
    expect(eligibility.forcedReason).toBe("opening");
    expect(eligibility.allowedSpeakers.map((s) => s.id)).toEqual(["e_host"]);
    expect(eligibility.canClose).toBe(false);
    expect(eligibility.mustClose).toBe(false);
  });

  it("覆盖保底之前不许收：即使饱和也 mustClose=false", () => {
    const messages = makeHistory([
      ["e_host", "opening", "开场。"],
      ["e_1", "extend", "我说一句。"],
    ]);
    const snapshot = makeSnapshot({
      messages,
      turnCount: 2,
      insights: [makeInsight("i_1", "consensus", "双方都认为职责会变", ["m_1", "m_2"], 1)],
    });
    const eligibility = buildEligibility(snapshot);
    expect(eligibility.turnIndex).toBe(3);
    expect(eligibility.coverageFloor).toBe(10);
    expect(eligibility.canClose).toBe(false);
    expect(eligibility.mustClose).toBe(false);
  });

  it("过了保底但没饱和：继续，不收", () => {
    const messages = makeHistory(
      Array.from({ length: 12 }, (_, i) => [
        `e_${(i % 4) + 1}`,
        "extend" as const,
        `第 ${i + 1} 条观点，内容各不相同，用来撑满覆盖。`,
      ]),
    );
    const snapshot = makeSnapshot({ messages, turnCount: 12 });
    const eligibility = buildEligibility(snapshot);
    expect(eligibility.canClose).toBe(true);
    expect(eligibility.saturation.ready).toBe(false);
    expect(eligibility.mustClose).toBe(false);
  });

  it("旧分歧 + 最近 4 轮无新观点 → 饱和，可以收", () => {
    const history: Array<[string, "opening" | "extend" | "rebut" | "probe", string]> = [
      ["e_host", "opening", "今天先切一个可争论的口子。"],
      ["e_1", "extend", "我认为岗位会重构，不会整体消失。"],
      ["e_2", "rebut", "你忽略了转型期的时间成本。"],
      ["e_3", "extend", "先看劳动力供需曲线再谈结论。"],
      ["e_4", "extend", "小团队加助手已经替代了一整个层级。"],
      ["e_host", "probe", "你说的成本到底由谁承担？"],
      ["e_1", "rebut", "成本主要由企业承担，但可以通过再培训摊薄。"],
      ["e_2", "extend", "摊薄的前提是企业愿意出这笔钱。"],
      ["e_3", "extend", "供需两侧都在动，单看岗位数量会得出相反结论。"],
      ["e_4", "extend", "现实里没几家愿意为初级岗位付再培训的钱。"],
    ];
    const messages = makeHistory(history);
    // 关键：分歧产生在第 3 轮，距当前（第 12 轮）已超过窗口
    const insights = [
      makeInsight("i_1", "divergence", "分歧在于成本由企业还是个人承担", ["m_3", "m_7"], 3),
      makeInsight("i_2", "consensus", "双方都承认岗位职责会变化", ["m_2", "m_4"], 2),
    ];
    // 补两轮"纯重复、无新洞察"的发言，让最近 4 轮没有新东西
    messages.push(makeMessage("m_11", "e_1", 11, "extend", "我还是那个判断，成本可以被摊薄。"));
    messages.push(makeMessage("m_12", "e_2", 12, "extend", "我还是觉得企业不会出这笔钱。"));

    const snapshot = makeSnapshot({ messages, insights, turnCount: 12 });
    const map = buildDebateMap(snapshot);
    expect(map.saturation.ready).toBe(true);
    expect(map.saturation.blockingChallengeCount).toBe(0);
    // 旧分歧允许保留，并进入总结素材
    expect(map.saturation.acceptedUnresolved.length).toBeGreaterThan(0);

    const eligibility = buildEligibility(snapshot);
    expect(eligibility.canClose).toBe(true);
    expect(eligibility.closeReason).toBe("saturated");
    expect(eligibility.mustClose).toBe(true);
  });

  it("最近 4 轮有新洞察 → 不饱和", () => {
    const messages = makeHistory(
      Array.from({ length: 12 }, (_, i) => [
        `e_${(i % 4) + 1}`,
        "extend" as const,
        `第 ${i + 1} 条观点，内容各不相同。`,
      ]),
    );
    const insights = [makeInsight("i_1", "consensus", "双方都认为职责会变", ["m_1", "m_2"], 10)];
    const snapshot = makeSnapshot({ messages, insights, turnCount: 12 });
    const map = buildDebateMap(snapshot);
    expect(map.saturation.ready).toBe(false);
    expect(map.saturation.reasons.join()).toContain("新洞察");
  });

  it("最近 4 轮有未回应的挑战 → 阻塞收束", () => {
    const messages = makeHistory([
      ["e_1", "extend", "我认为会重构。"],
      ["e_2", "rebut", "你忽略了时间成本。", "m_1"],
      ["e_3", "extend", "看供需。"],
      ["e_4", "extend", "已经替代了一个层级。"],
      ["e_1", "extend", "我还是坚持重构论。"],
    ]);
    const insights = [makeInsight("i_1", "consensus", "双方都承认会变", ["m_1", "m_3"], 2)];
    const snapshot = makeSnapshot({ messages, insights, turnCount: 5 });
    const map = buildDebateMap(snapshot);
    expect(map.saturation.blockingChallengeCount).toBeGreaterThan(0);
    expect(map.saturation.ready).toBe(false);
  });

  it("到安全上限必须收（hard_cap）", () => {
    const snapshot = makeSnapshot({ turnCount: 36 });
    const eligibility = buildEligibility(snapshot);
    expect(eligibility.mustClose).toBe(true);
    expect(eligibility.closeReason).toBe("hard_cap");
    expect(eligibility.allowedSpeakers.map((s) => s.id)).toEqual(["e_host"]);
  });

  it("evaluateClose 只看保底与饱和，不看 plannedTurns", () => {
    expect(evaluateClose(11, 36, true, sat())).toBe("saturated");
    expect(evaluateClose(11, 36, false, sat())).toBeUndefined();
    expect(evaluateClose(36, 36, false, sat({ ready: false }))).toBe("hard_cap");
  });

  it("连续发言达到 2 次的人被剔除", () => {
    const messages = makeHistory([
      ["e_host", "opening", "先抛个判断。"],
      ["e_1", "extend", "第一句。"],
      ["e_1", "extend", "第二句。"],
    ]);
    const snapshot = makeSnapshot({ messages, turnCount: 3 });
    const eligibility = buildEligibility(snapshot);
    expect(consecutiveTail(snapshot, "e_1")).toBe(2);
    expect(eligibility.allowedSpeakers.map((s) => s.id)).not.toContain("e_1");
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

  it("欠回答的人进入 prioritySpeakerIds", () => {
    const messages = makeHistory([
      ["e_host", "opening", "开场。"],
      ["e_1", "extend", "我认为会重构。"],
      ["e_2", "rebut", "你忽略了时间成本。", "m_2"],
      ["e_3", "extend", "看供需。"],
      ["e_4", "extend", "已经替代了一整个层级。"],
    ]);
    const snapshot = makeSnapshot({ messages, turnCount: 5 });
    const eligibility = buildEligibility(snapshot);
    expect(eligibility.openChallengeCount).toBe(1);
    expect(eligibility.prioritySpeakerIds).toContain("e_1");
  });

  it("hostQuotaOf 统计各分型次数，上限随安全上限放大", () => {
    const messages = makeHistory([
      ["e_host", "opening", "开场。"],
      ["e_host", "probe", "追问。"],
      ["e_host", "mediate", "串联。"],
    ]);
    const quota = hostQuotaOf(makeSnapshot({ messages }), makeSnapshot().experts[0]);
    expect(quota).toMatchObject({ used: 3, openingDone: true, probeUsed: 1, mediateUsed: 1 });
    expect(quota.limit).toBe(6);
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
      turnFocus: "岗位到底会不会被替代？",
    };
    const result = sanitizeDecision(decision, snapshot, eligibility);
    expect(eligibility.allowedSpeakers.map((s) => s.id)).toContain(result.decision.speakerId);
    expect(result.repaired).toBe(true);
  });

  it("未到收尾轮却给 summary → 降级为 extend", () => {
    const decision: TurnDecision = {
      speakerId: eligibility.allowedSpeakers[0]!.id,
      intent: "summary",
      turnFocus: "岗位到底会不会被替代？",
    };
    expect(sanitizeDecision(decision, snapshot, eligibility).decision.intent).toBe("extend");
  });

  it("未收敛时 action=close 被忽略", () => {
    const decision: TurnDecision = {
      speakerId: eligibility.allowedSpeakers[0]!.id,
      intent: "extend",
      turnFocus: "岗位到底会不会被替代？",
      action: "close",
    };
    const result = sanitizeDecision(decision, snapshot, eligibility);
    expect(result.decision.action).toBe("next");
    expect(result.issues.some((i) => i.code === "CLOSE_NOT_ALLOWED")).toBe(true);
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
      {
        speakerId: "e_1",
        intent: "rebut",
        turnFocus: "岗位到底会怎么变？",
        targetMessageId: own.id,
      },
      spoken,
      spokenEligibility,
    );
    expect(result.decision.targetMessageId).toBeUndefined();
    expect(result.decision.intent).toBe("extend");
  });

  it("turnFocus 写成名词标签 → 被改写成争点", () => {
    const result = sanitizeDecision(
      { speakerId: eligibility.allowedSpeakers[0]!.id, intent: "extend", turnFocus: "岗位结构" },
      snapshot,
      eligibility,
    );
    expect(result.decision.turnFocus).toMatch(/？$/u);
    expect(result.repaired).toBe(true);
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
  });

  it("validateDecision 对合法决策返回 ok", () => {
    const speakerId = eligibility.allowedSpeakers[0]!.id;
    const other = snapshot.messages.find((m) => m.expertId !== speakerId)!;
    const decision: TurnDecision = {
      speakerId,
      intent: "support",
      turnFocus: "岗位到底会不会被替代？",
      targetMessageId: other.id,
    };
    const validation = validateDecision(decision, snapshot, eligibility);
    expect(validation.issues).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  it("fallback 优先让欠回答的人接账", () => {
    const messages = makeHistory([
      ["e_host", "opening", "开场。"],
      ["e_1", "extend", "我认为会重构。"],
      ["e_2", "rebut", "你忽略了时间成本。", "m_2"],
      ["e_3", "extend", "看供需。"],
      ["e_4", "extend", "已经替代了一整个层级。"],
    ]);
    const owed = makeSnapshot({ messages, turnCount: 5 });
    const owedEligibility = buildEligibility(owed);
    const { decision, reasonCode } = selectFallbackSpeaker(owed, owedEligibility);
    if (owedEligibility.allowedSpeakers.length > 1) {
      expect(owedEligibility.prioritySpeakerIds).toContain(decision.speakerId);
      expect(reasonCode).toBe("answer_challenge");
    }
    expect(decision.turnFocus).toMatch(/？$/u);
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
        colorKey: "ocean",
      },
      {
        name: "周明",
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
  });

  it("超过 120 字被截断", () => {
    const check = validateSpeech(`${"很长的发言内容，".repeat(20)}。`);
    expect(check.charCount).toBeLessThanOrEqual(120);
  });

  it("主持人上限 60 字", () => {
    const check = validateSpeech(
      "主持人这句话要短一些，不能长篇大论地讲道理，否则就会变成讲课而不是主持。",
      { isHost: true },
    );
    expect(check.charCount).toBeLessThanOrEqual(61);
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
    expect(validateSpeech("   ").reasons).toContain("empty");
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
    expect(result.rejected[0]?.reason).toBe("evidence_unknown");
  });

  it("共识只有单人证据 → 丢弃", () => {
    const result = normalizeInsights(
      [{ type: "consensus", content: "双方都认为职责会变", evidenceMessageIds: ["m_2", "m_2"] }],
      snapshot,
    );
    expect(result.rejected[0]?.reason).toBe("need_two_speakers");
  });

  it("数字无法在证据里溯源 → 丢弃", () => {
    const result = normalizeInsights(
      [
        {
          type: "divergence",
          content: "压缩幅度是 60% 还是 30%",
          evidenceMessageIds: ["m_2", "m_3"],
        },
      ],
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
    expect(result.insights[0]?.evidenceMessageIds).toEqual(["m_2", "m_3"]);
    expect(result.insights[0]?.id).toMatch(/^i_/);
  });

  it("与已有条目近似时合并不新增 id", () => {
    const result = normalizeInsights(
      [
        {
          type: "consensus",
          content: "双方都认为职责会变化",
          evidenceMessageIds: ["m_2", "m_3", "m_4"],
        },
      ],
      snapshot,
    );
    expect(result.insights[0]?.id).toBe("i_old");
    expect(result.added).toBe(0);
  });

  it("拒绝原因可压成一行给日志", () => {
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
