/** 纯文本工具：不依赖任何外部库，便于单测。 */

const CJK_START = 0x2e80;
const CJK_END = 0x9fff;

/**
 * 保守的 token 估算：CJK 每字约 1 token，其它每 3.5 字符约 1 token。
 * 宁可高估——预算是硬约束，低估会直接撑爆上下文。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= CJK_START && code <= CJK_END) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 3.5);
}

/** 按字符截断（不切断代理对），超长时补省略号。 */
export function truncateChars(text: string, max: number, ellipsis = "…"): string {
  if (max <= 0) return "";
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, max).join("") + ellipsis;
}

/** 中文句末标点计数；省略号/破折号不算句子。 */
export function countSentences(text: string): number {
  const matches = text.match(/[。！？!?]/g);
  return matches ? matches.length : 0;
}

/** 按句末标点切句，保留标点；没有标点时整段算一句。 */
export function splitSentences(text: string): string[] {
  const matches = text.match(/[^。！？!?]+[。！？!?]+/gu);
  if (!matches) {
    const trimmed = text.trim();
    return trimmed ? [trimmed] : [];
  }
  const tail = text.slice(matches.join("").length).trim();
  const result = matches.map((s) => s.trim());
  if (tail) result.push(tail);
  return result.filter(Boolean);
}

/** 把换行、连续空白压成单个空格。 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 去掉 markdown/前缀噪音，保留纯文本发言。 */
export function stripFormatting(raw: string): string {
  let text = raw.trim();
  // 整段 code fence
  text = text.replace(/^```[a-zA-Z]*\s*/u, "").replace(/```$/u, "").trim();
  // 引号包裹
  text = text.replace(/^["'“”「『]+/u, "").replace(/["'“”」』]+$/u, "").trim();
  // 「姓名：」或「[姓名]：」前缀
  text = text.replace(/^[\[【]?[\u4e00-\u9fa5]{2,4}[\]】]?\s*[：:]\s*/u, "");
  // 行首 markdown 标记
  text = text.replace(/^\s{0,3}(?:[-*+>#]+\s*)/u, "");
  text = text.replace(/\*\*/g, "").replace(/__/g, "");
  // 括号动作（（摇头）/[叹气]）
  text = text.replace(/[（(][^）)]{1,12}[）)]/gu, "");
  return normalizeWhitespace(text);
}

/** 字符 3-gram Jaccard 相似度，用于重复检测与共识去重。 */
export function char3GramJaccard(a: string, b: string): number {
  const ga = char3Grams(a);
  const gb = char3Grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let intersection = 0;
  for (const gram of ga) if (gb.has(gram)) intersection += 1;
  const union = ga.size + gb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function char3Grams(text: string): Set<string> {
  const chars = Array.from(normalizeWhitespace(text));
  const grams = new Set<string>();
  if (chars.length < 3) {
    if (chars.length > 0) grams.add(chars.join(""));
    return grams;
  }
  for (let i = 0; i + 3 <= chars.length; i += 1) {
    grams.add(chars.slice(i, i + 3).join(""));
  }
  return grams;
}

/** 抽出文本中的数字串（含小数与百分号），用于「数字必须可溯源」校验。 */
export function extractNumbers(text: string): string[] {
  const matches = text.match(/[0-9]+(?:\.[0-9]+)?%?/g);
  return matches ? [...new Set(matches)] : [];
}

/** 稳定 32 位哈希（FNV-1a），用于确定性 tie-break 与稳定 id。 */
export function hash32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 稳定短 id：`prefix_<hash>`。 */
export function stableId(prefix: string, seed: string): string {
  return `${prefix}_${hash32(seed)}`;
}
