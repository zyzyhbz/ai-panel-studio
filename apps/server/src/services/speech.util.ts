import { truncateToSentence } from "../lib/text";

/** Contract: one utterance is 1–2 sentences, <= 120 Chinese characters (AR-04). */
export const SPEECH_MAX_CHARS = 120;

/**
 * Deterministic, persona-consistent line used when generation fails twice
 * (AR-09 / docs/06 §1.4 `degraded: true`).
 */
export function fallbackSpeechFor(name: string, stance: string, turnFocus: string): string {
  const focus = turnFocus.trim() || "这个问题";
  const position = stance.trim().replace(/。$/, "");
  if (position) {
    return truncateToSentence(`我把话说直一点：${position}。`, SPEECH_MAX_CHARS);
  }
  return truncateToSentence(
    `${name}认为${focus}还需要更多证据，不能这么快下结论。`,
    SPEECH_MAX_CHARS,
  );
}
