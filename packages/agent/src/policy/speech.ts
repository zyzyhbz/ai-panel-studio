import type { TranscriptMessage } from "../core/types";
import {
  char3GramJaccard,
  countSentences,
  normalizeWhitespace,
  splitSentences,
  stripFormatting,
  truncateChars,
} from "../core/text";

export { splitSentences };

/**
 * 发言后置校验（AR-04 + 反重复 + 反冒名）。
 *
 * 发言是纯文本流式输出，没有 JSON 包装，所以长度/句数/格式只能在这里兜。
 * 原则：只截断、清洗，绝不扩写；扩写等于替模型编内容。
 */

export const SPEECH_MAX_CHARS = 120;
export const SPEECH_TARGET_CHARS = 80;
export const HOST_MAX_CHARS = 60;
export const MAX_SENTENCES = 2;
export const REPETITION_THRESHOLD = 0.5;

const META_PATTERNS: RegExp[] = [
  /作为\s*(?:一个)?\s*(?:AI|人工智能|助手|语言模型)/iu,
  /我是\s*(?:一个)?\s*(?:AI|人工智能|模型|助手)/iu,
  /^以下是/u,
  /^好的[，,]/u,
];

export interface SpeechCheck {
  ok: boolean;
  /** 可直接落库的文本（已清洗、已截断） */
  text: string;
  charCount: number;
  sentenceCount: number;
  /** 与最近发言的最高相似度 */
  maxSimilarity: number;
  repeated: boolean;
  reasons: string[];
}

export interface SpeechCheckOptions {
  maxChars?: number;
  maxSentences?: number;
  recent?: TranscriptMessage[];
  similarityThreshold?: number;
  /** 主持人的发言更短 */
  isHost?: boolean;
}

export function normalizeSpeech(raw: string): string {
  return stripFormatting(raw);
}

export function validateSpeech(raw: string, options: SpeechCheckOptions = {}): SpeechCheck {
  const maxChars = options.maxChars ?? (options.isHost ? HOST_MAX_CHARS : SPEECH_MAX_CHARS);
  const maxSentences = options.maxSentences ?? MAX_SENTENCES;
  const threshold = options.similarityThreshold ?? REPETITION_THRESHOLD;
  const reasons: string[] = [];

  let text = normalizeSpeech(raw);
  if (!text) {
    return {
      ok: false,
      text: "",
      charCount: 0,
      sentenceCount: 0,
      maxSimilarity: 0,
      repeated: false,
      reasons: ["empty"],
    };
  }

  for (const pattern of META_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push("meta");
      text = text.replace(pattern, "").trim();
      break;
    }
  }

  const sentences = splitSentences(text);
  if (sentences.length > maxSentences) {
    reasons.push("too_many_sentences");
    text = sentences.slice(0, maxSentences).join("");
  }

  if (Array.from(text).length > maxChars) {
    reasons.push("too_long");
    text = cutToBudget(text, maxChars);
  }

  text = normalizeWhitespace(text);
  const chars = Array.from(text).length;

  let maxSimilarity = 0;
  for (const message of options.recent ?? []) {
    const similarity = char3GramJaccard(text, message.content);
    if (similarity > maxSimilarity) maxSimilarity = similarity;
  }
  const repeated = maxSimilarity > threshold;
  if (repeated) reasons.push("repetitive");

  const ok = !repeated && chars > 0 && !reasons.includes("meta");

  return {
    ok,
    text,
    charCount: chars,
    sentenceCount: countSentences(text),
    maxSimilarity,
    repeated,
    reasons,
  };
}

/** 超长时优先在句末截断，其次硬截并补省略号（不新增语义）。 */
function cutToBudget(text: string, maxChars: number): string {
  const sentences = splitSentences(text);
  let buffer = "";
  for (const sentence of sentences) {
    const next = buffer + sentence;
    if (Array.from(next).length > maxChars) break;
    buffer = next;
  }
  if (buffer.length > 0) return buffer;
  return truncateChars(text, Math.max(1, maxChars - 1), "…");
}
