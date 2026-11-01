import { describe, expect, it } from "vitest";
import {
  parseDecisionOutput,
  parseInsightOutput,
  parseRosterOutput,
  parseSummaryText,
} from "../parse/output";
import { fixtureRosterJson, TOPIC_FIXTURES } from "../llm/fixtures";

const rosterJson = fixtureRosterJson(TOPIC_FIXTURES[0]!);

describe("roster schema", () => {
  it("接受 colorKey（调色板）与 color（hex）两种颜色写法", () => {
    const parsed = parseRosterOutput(rosterJson);
    expect(parsed.experts).toHaveLength(4);
    expect(parsed.experts[0]?.colorKey).toBe("ocean");
    // fixture 的主持人用 hex
    expect(parsed.host.color).toBe("#D9D9D9");
  });

  it("拒绝 colorKey 与 color 同时出现", () => {
    const broken = JSON.parse(rosterJson) as Record<string, unknown>;
    (broken.experts as Array<Record<string, unknown>>)[0]!.color = "#123456";
    expect(() => parseRosterOutput(JSON.stringify(broken))).toThrow(/二选一|color/);
  });

  it("拒绝多出来的字段（strict）", () => {
    const broken = JSON.parse(rosterJson) as { experts: Array<Record<string, unknown>> };
    broken.experts[0]!.style = "data";
    expect(() => parseRosterOutput(JSON.stringify(broken))).toThrow();
  });

  it("拒绝越界字数（stance > 40）", () => {
    const broken = JSON.parse(rosterJson) as { experts: Array<Record<string, unknown>> };
    broken.experts[0]!.stance = "这".repeat(41);
    expect(() => parseRosterOutput(JSON.stringify(broken))).toThrow();
  });

  it("能容忍 code fence 包裹", () => {
    expect(() => parseRosterOutput("```json\n" + rosterJson + "\n```")).not.toThrow();
  });
});

describe("decision schema", () => {
  const base = {
    speakerId: "e_2",
    intent: "rebut",
    turnFocus: "岗位结构的变化速度",
    targetMessageId: "m_3",
  };

  it("接受最小合法决策", () => {
    const parsed = parseDecisionOutput(JSON.stringify(base));
    expect(parsed.speakerId).toBe("e_2");
    expect(parsed.action).toBeUndefined();
  });

  it("拒绝非法 intent", () => {
    expect(() =>
      parseDecisionOutput(JSON.stringify({ ...base, intent: "agree" })),
    ).toThrow();
  });

  it("拒绝超过 20 字的 turnFocus", () => {
    expect(() =>
      parseDecisionOutput(
        JSON.stringify({ ...base, turnFocus: "这是一个明显超过二十个字的所谓关注点描述文本内容" }),
      ),
    ).toThrow();
  });
});

describe("insight schema", () => {
  it("接受空快照（合法答案）", () => {
    expect(parseInsightOutput('{"insights":[]}').insights).toEqual([]);
  });

  it("拒绝没有证据的条目", () => {
    const raw = JSON.stringify({
      insights: [{ type: "consensus", content: "大家都觉得要理性", evidenceMessageIds: [] }],
    });
    expect(() => parseInsightOutput(raw)).toThrow();
  });

  it("不再接受已删除的 status / axis 字段（strict）", () => {
    const raw = JSON.stringify({
      insights: [
        {
          type: "consensus",
          content: "双方都认为职责会重组",
          evidenceMessageIds: ["m_1", "m_2"],
          status: "active",
        },
      ],
    });
    expect(() => parseInsightOutput(raw)).toThrow();
  });
});

describe("summary 解析", () => {
  const good = "这场里几位在一个点上收拢了：岗位会被重构。\n\n没谈拢的是压缩还是升级。\n\n还悬着的是谁为再培训买单。";

  it("三段自然语言通过", () => {
    const check = parseSummaryText(good);
    expect(check.ok).toBe(true);
    expect(check.paragraphs).toHaveLength(3);
    expect(check.hasJsonLeak).toBe(false);
  });

  it("出现 JSON 痕迹直接抛错", () => {
    expect(() => parseSummaryText('{"consensus":"x","divergence":"y"}')).toThrow(/JSON/);
  });

  it("过短判为不 ok", () => {
    const check = parseSummaryText("太短了。\n\n真的短。\n\n短。");
    expect(check.ok).toBe(false);
    expect(check.reasons).toContain("too_short");
  });
});
