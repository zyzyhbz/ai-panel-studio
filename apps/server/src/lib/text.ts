import { createHash } from "node:crypto";

/** Count Unicode code points (not UTF-16 units) — contract counts characters. */
export function codePointLength(value: string): number {
  let n = 0;
  for (const _ of value) n += 1;
  return n;
}

/** Strip control chars except \n and \t, collapse \r\n, trim. Plain text only. */
export function normalizePlainText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

/** Collapse all whitespace runs to a single space (for hashing / previews). */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Normalized content hash used as the insight identity key. */
export function contentHash(type: string, content: string): string {
  return sha256Hex(`${type}\u0000${collapseWhitespace(content).toLowerCase()}`);
}

const SENTENCE_END = /[。！？!?；;…]/;

/**
 * Truncate to <= max code points without cutting a sentence mid-way when a
 * sentence boundary exists in range. Never appends "..." to already-short text.
 */
export function truncateToSentence(value: string, max: number): string {
  const text = normalizePlainText(value);
  if (codePointLength(text) <= max) return text;
  const chars = [...text];
  const head = chars.slice(0, max);
  let cut = -1;
  for (let i = head.length - 1; i >= Math.floor(max * 0.5); i -= 1) {
    if (SENTENCE_END.test(head[i] ?? "")) {
      cut = i + 1;
      break;
    }
  }
  const out = cut > 0 ? head.slice(0, cut) : head;
  return out.join("").trimEnd();
}

/** Reject text that looks like leaked JSON structure (guards summary output). */
export function looksLikeJson(value: string): boolean {
  const t = value.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return false;
  return /"\s*[A-Za-z_]+\s*":/.test(t) || t.endsWith("}");
}

/** Remove wrapping code fences and stray JSON if a model ignored response_format. */
export function stripCodeFences(value: string): string {
  const t = value.trim();
  const fence = /^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/.exec(t);
  return fence?.[1]?.trim() ?? t;
}

/** Extract the first balanced JSON object/array from a noisy string. */
export function extractJson(value: string): string | null {
  const text = stripCodeFences(value);
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function preview(value: string, max = 80): string {
  const text = collapseWhitespace(value);
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max).join("")}…`;
}
