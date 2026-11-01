import type { CSSProperties } from "react";

import type { StreamBuffer } from "../domain/streamBuffer";
import type { SessionView } from "../domain/session";
import { useStreamSnapshot } from "../lib/useStreamSnapshot";
import { safeColor } from "../lib/color";

interface SeatPoint {
  x: number;
  y: number;
}

/** Pick the bubble edge facing the speaker, and slide the tail along it. */
function tailFor(point: SeatPoint | undefined): {
  side: "top" | "right" | "bottom" | "left";
  offset: number;
} {
  if (!point) return { side: "bottom", offset: 50 };
  const dx = point.x - 50;
  const dy = point.y - 36;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      side: dx < 0 ? "left" : "right",
      offset: Math.max(16, Math.min(84, 50 + (point.y - 47) * 1.1)),
    };
  }
  return {
    side: dy < 0 ? "top" : "bottom",
    offset: Math.max(18, Math.min(82, 50 + (point.x - 50) * 1.1)),
  };
}

/**
 * One speech bubble on the round table.
 *
 * - While a turn is active it shows the live streamed text (or a short
 *   "organising" placeholder before the first token).
 * - After the turn ends it keeps the completed sentence and fades out with a
 *   2s CSS animation; the next turn replaces it immediately.
 * - The tail is placed on the bubble edge facing that speaker's seat.
 * - It subscribes to the token buffer itself, so the seats/insights do not
 *   re-render on every delta.
 */
export function SpeechBubble({
  view,
  buffer,
  seatPoints,
  now,
}: {
  view: SessionView;
  buffer: StreamBuffer;
  seatPoints: Map<string, SeatPoint>;
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
  const tail = tailFor(seatPoints.get(source.speakerId));

  return (
    <div
      data-testid="speech-bubble"
      data-phase={source.phase}
      data-tail-side={tail.side}
      className="round-bubble"
      style={
        {
          borderColor: color,
          "--bubble-border": color,
          "--tail-offset": `${tail.offset}%`,
        } as CSSProperties
      }
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
      <span
        data-testid="speech-bubble-tail"
        data-side={tail.side}
        className="round-bubble-tail"
        aria-hidden
      />
    </div>
  );
}
