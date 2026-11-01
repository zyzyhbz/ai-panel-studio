import { describe, expect, it } from "vitest";
import {
  char3GramJaccard,
  estimateTokens,
  extractNumbers,
  hash32,
  splitSentences,
  stripFormatting,
  truncateChars,
} from "../core/text";

describe("estimateTokens", () => {
  it("中文按 ~1 token/字，英文按 ~3.5 字符/token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("你好世界")).toBe(4);
    expect(estimateTokens("abcdefg")).toBe(2);
  });

  it("宁可高估：中英混排时不小于字符数的一半", () => {
    const text = "AI 会重构初级岗位，而不是整体消灭它";
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(Math.ceil(Array.from(text).length / 2));
  });
});

describe("truncateChars", () => {
  it("不切断代理对，超长补省略号", () => {
    expect(truncateChars("一二三四", 2)).toBe("一二…");
    expect(truncateChars("一二", 5)).toBe("一二");
  });
});

describe("splitSentences", () => {
  it("按句末标点切句并保留标点", () => {
    expect(splitSentences("第一句。第二句！")).toEqual(["第一句。", "第二句！"]);
  });

  it("没有句末标点时整段算一句", () => {
    expect(splitSentences("没有标点的一句话")).toEqual(["没有标点的一句话"]);
  });
});

describe("stripFormatting", () => {
  it("去掉姓名前缀、markdown、括号动作", () => {
    expect(stripFormatting("周明：我认为**不对**（摇头）")).toBe("我认为不对");
  });

  it("去掉 code fence 与引号", () => {
    expect(stripFormatting("```text\n「他说得对。」\n```")).toBe("他说得对。");
  });
});

describe("char3GramJaccard", () => {
  it("相同文本相似度为 1，完全不同为 0", () => {
    expect(char3GramJaccard("初级岗位会被重构", "初级岗位会被重构")).toBe(1);
    expect(char3GramJaccard("初级岗位会被重构", "一共有三句话要说")).toBe(0);
  });

  it("近似复述会得到高相似度", () => {
    const a = "AI 先替代的是任务，不是人";
    const b = "AI 先替代的是任务而不是人";
    expect(char3GramJaccard(a, b)).toBeGreaterThan(0.5);
  });
});

describe("extractNumbers", () => {
  it("抽出数字与百分比", () => {
    expect(extractNumbers("效率提升 30%，成本降 1.5 倍")).toEqual(["30%", "1.5"]);
  });
});

describe("hash32", () => {
  it("同输入同输出，不同输入不同输出", () => {
    expect(hash32("abc")).toBe(hash32("abc"));
    expect(hash32("abc")).not.toBe(hash32("abd"));
    expect(hash32("abc")).toHaveLength(8);
  });
});
