import type { DiscussionSnapshot } from "../core/types";
import type { SummaryOutput } from "../schema/summary";

/**
 * 总结规范化（纯文本三段，不是 JSON）。
 *
 * 两条底线：
 * 1. 出现 JSON 痕迹 → 判失败（FR-10 明令禁止把 JSON 原文给用户看）；
 * 2. 失败时必须能给一个**由既有 insights 拼出的**模板总结，不能再调一次模型。
 */

export const SUMMARY_MIN_CHARS = 20;
export const SUMMARY_MAX_CHARS = 400;

const JSON_LEAK_PATTERNS: RegExp[] = [
  /[{}]/u,
  /"insights"\s*:/u,
  /"content"\s*:/u,
  /evidenceMessageIds/u,
  /"type"\s*:\s*"(consensus|divergence|open_question)"/u,
];

export interface SummaryCheck {
  ok: boolean;
  content: string;
  paragraphs: string[];
  hasJsonLeak: boolean;
  reasons: string[];
}

export function normalizeSummary(raw: string): SummaryCheck {
  const reasons: string[] = [];
  let text = raw.trim();

  // 去掉整体 code fence
  text = text.replace(/^```[a-zA-Z]*\s*/u, "").replace(/```$/u, "").trim();

  const hasJsonLeak = JSON_LEAK_PATTERNS.some((pattern) => pattern.test(text));
  if (hasJsonLeak) reasons.push("json_leak");

  const paragraphs = text
    .split(/\n\s*\n/u)
    .map((p) => p.replace(/^\s{0,3}(?:[-*+>#]+\s*)/u, "").trim())
    .filter(Boolean);

  if (paragraphs.length < 2) reasons.push("too_few_paragraphs");
  if (paragraphs.length > 4) {
    reasons.push("too_many_paragraphs");
    paragraphs.length = 4;
  }

  let content = paragraphs.join("\n\n");
  if (Array.from(content).length > SUMMARY_MAX_CHARS) {
    content = clampParagraphs(paragraphs, SUMMARY_MAX_CHARS);
    reasons.push("too_long");
  }
  if (Array.from(content).length < SUMMARY_MIN_CHARS) reasons.push("too_short");

  const ok = !hasJsonLeak && Array.from(content).length >= SUMMARY_MIN_CHARS;

  return {
    ok,
    content,
    paragraphs,
    hasJsonLeak,
    reasons,
  };
}

function clampParagraphs(paragraphs: string[], max: number): string {
  let out = "";
  for (const paragraph of paragraphs) {
    const next = out ? `${out}\n\n${paragraph}` : paragraph;
    if (Array.from(next).length > max) break;
    out = next;
  }
  return out || Array.from(paragraphs[0] ?? "").slice(0, max).join("");
}

/**
 * 模板总结：只重排既有 insights，不引入任何新主张。
 * 用于「总结超时/无效/JSON 泄漏」的最终兜底（summary.isFallback=true）。
 */
export function buildFallbackSummary(snapshot: DiscussionSnapshot): string {
  const pick = (type: "consensus" | "divergence" | "open_question", limit = 2): string[] =>
    snapshot.insights
      .filter((insight) => insight.type === type)
      .slice(0, limit)
      .map((insight) => insight.content);

  const consensus = pick("consensus");
  const divergence = pick("divergence");
  const open = pick("open_question");

  const first =
    consensus.length > 0
      ? `这场里，几位在一个点上收拢了：${consensus.join("；")}。这一点上没有出现明显的反对。`
      : "这场没有形成明确共识，几位更多是从各自角度补充，各说各的部分。";

  const second =
    divergence.length > 0
      ? `没有谈拢的是：${divergence.join("；")}。`
      : "讨论中没有出现正面冲突，更多是侧重点不同。";

  const thirdParts: string[] = [];
  if (open.length > 0) thirdParts.push(`还悬着的是：${open.join("；")}。`);
  else thirdParts.push("这一场没有留下明确未决的问题。");
  thirdParts.push("如果要带走一句话：这场讨论没有给出标准答案，但把分歧的位置标出来了。");

  return [first, second, thirdParts.join("")].join("\n\n");
}

/** 落库前的最后一道门：模板总结也必须通过同一条规范化。 */
export function toSummaryOutput(content: string, isFallback: boolean): SummaryOutput {
  const check = normalizeSummary(content);
  return {
    content: check.content,
    paragraphs: check.paragraphs,
    hasJsonLeak: check.hasJsonLeak,
  };
}
