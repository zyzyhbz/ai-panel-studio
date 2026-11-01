import type { StreamBuffer } from "../domain/streamBuffer";
import type { SessionView } from "../domain/session";
import { useStreamSnapshot } from "../lib/useStreamSnapshot";
import { safeColor } from "../lib/color";

/**
 * One speech bubble on the round table.
 *
 * - While a turn is active it shows the live streamed text (or a short
 *   "organising" placeholder before the first token).
 * - After the turn ends it keeps the completed sentence for two seconds and
 *   fades out; the next turn replaces it immediately.
 * - It subscribes to the token buffer itself, so the seats/insights do not
 *   re-render on every delta.
 */
export function SpeechBubble({
  view,
  buffer,
  now,
}: {
  view: SessionView;
  buffer: StreamBuffer;
  now: number;
}) {
  const stream = useStreamSnapshot(buffer);
  const active = view.activeTurn;
  const activeMessage = active
    ? view.messages.find((message) => message.id === active.messageId)
    : undefined;
  const streamed =
    active && stream?.messageId === active.messageId
      ? stream.text || stream.accepted
      : "";
  const latest = view.messages.at(-1);
  const age = latest?.createdAt ? now - Date.parse(latest.createdAt) : Number.POSITIVE_INFINITY;
  const fading =
    !active &&
    latest &&
    age < 2400 &&
    (view.status === "live" || view.status === "summarizing");

  const source = active
    ? {
        speakerId: active.speakerId,
        messageId: active.messageId,
        text: streamed || activeMessage?.content || "正在组织语言…",
        phase: streamed || activeMessage ? "speaking" : "preparing",
      }
    : fading
      ? {
          speakerId: latest.expertId,
          messageId: latest.id,
          text: latest.content,
          phase: "fading",
        }
      : null;

  if (!source) return null;

  const speaker = view.roster.find((item) => item.id === source.speakerId);
  const color = safeColor(speaker?.color);
  const opacity = active ? 1 : Math.max(0, 1 - age / 2000);

  return (
    <div
      data-testid="speech-bubble"
      data-phase={source.phase}
      className="round-bubble"
      style={{ opacity, borderColor: color }}
      aria-live="polite"
    >
      <div className="round-bubble-head">
        <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden />
        <span className="font-semibold" style={{ color }}>
          {speaker?.name ?? "发言者"}
        </span>
        <span className="round-bubble-state">
          {source.phase === "preparing"
            ? "思考中"
            : source.phase === "fading"
              ? "已发言"
              : "发言中"}
        </span>
      </div>
      <p className="round-bubble-text">{source.text}</p>
    </div>
  );
}
