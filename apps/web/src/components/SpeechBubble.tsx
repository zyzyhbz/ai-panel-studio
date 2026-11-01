import { useEffect, useState, type CSSProperties } from "react";

import type { StreamBuffer } from "../domain/streamBuffer";
import type { SessionView } from "../domain/session";
import { useStreamSnapshot } from "../lib/useStreamSnapshot";
import { safeColor } from "../lib/color";

interface SeatPoint {
  x: number;
  y: number;
}

interface BubbleSpec {
  key: string;
  speakerId: string;
  speakerName: string;
  messageId: string;
  text: string;
  phase: "preparing" | "speaking" | "fading";
  anchor: SeatPoint;
}

const BUBBLE_LIFETIME_MS = 2400;
const FADE_MS = 2000;

/** Place the bubble between the seat and the table centre (inward). */
function bubblePoint(anchor: SeatPoint): SeatPoint {
  return {
    x: 50 + (anchor.x - 50) * 0.56,
    y: 50 + (anchor.y - 50) * 0.56,
  };
}

/** Tail faces the speaker's seat, while the bubble body reaches inward. */
function tailFor(anchor: SeatPoint, point: SeatPoint): {
  side: "top" | "right" | "bottom" | "left";
  offset: number;
} {
  const dx = anchor.x - point.x;
  const dy = anchor.y - point.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      side: dx < 0 ? "left" : "right",
      offset: Math.max(16, Math.min(84, 50 + (anchor.y - point.y) * 2.2)),
    };
  }
  return {
    side: dy < 0 ? "top" : "bottom",
    offset: Math.max(16, Math.min(84, 50 + (anchor.x - point.x) * 2.2)),
  };
}

function Bubble({ spec, anchor, color }: { spec: BubbleSpec; anchor: SeatPoint; color: string }) {
  const point = bubblePoint(anchor);
  const tail = tailFor(anchor, point);
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    if (spec.phase !== "fading") {
      setOpacity(1);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / FADE_MS);
      setOpacity(1 - p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spec.key, spec.phase]);

  return (
    <div
      data-testid="speech-bubble"
      data-message-id={spec.messageId}
      data-phase={spec.phase}
      data-tail-side={tail.side}
      className="round-bubble"
      style={
        {
          left: `${point.x}%`,
          top: `${point.y}%`,
          opacity,
          zIndex: spec.phase === "fading" ? 2 : 3,
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
          {spec.speakerName}
        </span>
        <span className="round-bubble-state">
          {spec.phase === "preparing"
            ? "思考中"
            : spec.phase === "fading"
              ? "已发言"
              : "发言中"}
        </span>
      </div>
      <p className="round-bubble-text">{spec.text}</p>
      <span
        data-testid="speech-bubble-tail"
        data-side={tail.side}
        className="round-bubble-tail"
        aria-hidden
      />
    </div>
  );
}

/**
 * Multiple speech bubbles, one per recent turn.
 *
 * Each bubble is placed between the speaker's seat and the table centre, with
 * its tail pointing back to that seat. The active bubble is full opacity;
 * completed bubbles fade with requestAnimationFrame (≈60fps) over 2s and are
 * removed once the recent-message window expires.
 */
export function SpeechBubbles({
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

  const specs: BubbleSpec[] = [];

  if (view.status !== "ended" && view.status !== "failed") {
    const recent = view.messages
      .filter((message) => message.id !== active?.messageId)
      .filter((message) => now - Date.parse(message.createdAt) < BUBBLE_LIFETIME_MS)
      .slice(-3);
    for (const message of recent) {
      const anchor = seatPoints.get(message.expertId);
      if (!anchor) continue;
      specs.push({
        key: `${message.id}:fading`,
        speakerId: message.expertId,
        speakerName: view.roster.find((item) => item.id === message.expertId)?.name ?? message.speakerName,
        messageId: message.id,
        text: message.content,
        phase: "fading",
        anchor,
      });
    }
  }

  if (active) {
    const anchor = seatPoints.get(active.speakerId);
    if (anchor) {
      specs.push({
        key: `${active.messageId}:active`,
        speakerId: active.speakerId,
        speakerName: view.roster.find((item) => item.id === active.speakerId)?.name ?? "发言者",
        messageId: active.messageId,
        text: streamed || activeMessage?.content || "正在组织语言…",
        phase: streamed || activeMessage ? "speaking" : "preparing",
        anchor,
      });
    }
  }

  return (
    <>
      {specs.slice(-3).map((spec) => {
        const speaker = view.roster.find((item) => item.id === spec.speakerId);
        return (
          <Bubble
            key={spec.key}
            spec={spec}
            anchor={spec.anchor}
            color={safeColor(speaker?.color)}
          />
        );
      })}
    </>
  );
}
