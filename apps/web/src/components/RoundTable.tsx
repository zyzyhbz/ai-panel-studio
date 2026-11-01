import type { CSSProperties } from "react";

import type { Expert } from "../api/types";
import type { SessionView } from "../domain/session";
import {
  EXPERT_STATUS_LABEL,
  expertsOf,
  hostOf,
  type Convergence,
  type ExpertStatus,
  type Progress,
} from "../domain/selectors";
import { cn } from "../lib/cn";
import { readableInk, safeColor, tint } from "../lib/color";
import { formatClock } from "../lib/time";
import { SpeakingBars } from "./ExpertCard";

const STATUS_STYLE: Record<ExpertStatus, { text: string; dot: string }> = {
  idle: { text: "text-ink-4", dot: "bg-ink-4" },
  thinking: { text: "text-thinking", dot: "bg-thinking" },
  preparing: { text: "text-thinking", dot: "bg-thinking" },
  speaking: { text: "text-live", dot: "bg-live" },
  finished: { text: "text-ink-4", dot: "bg-ink-4" },
};

export function StatusTag({ status }: { status: ExpertStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span
      data-testid="seat-status"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-medium",
        style.text,
        status === "finished" && "opacity-70",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          style.dot,
          (status === "thinking" || status === "preparing") && "preparing-ring",
          status === "speaking" && "live-dot",
        )}
      />
      {EXPERT_STATUS_LABEL[status]}
    </span>
  );
}

interface Point {
  x: number;
  y: number;
}

/** Host at top centre; experts spread over the rest of the rim. */
export function seatPoint(index: number, count: number, isHost: boolean): Point {
  if (isHost) return { x: 50, y: 14 };
  const angle = -90 + ((index + 1) * 360) / (count + 1);
  const rad = (angle * Math.PI) / 180;
  return { x: 50 + 34 * Math.cos(rad), y: 50 + 33 * Math.sin(rad) };
}

function Seat({
  expert,
  status,
  active,
  focus,
  point,
}: {
  expert: Expert;
  status: ExpertStatus;
  active: boolean;
  focus: string | null;
  point: Point;
}) {
  const color = safeColor(expert.color);

  return (
    <div
      className="round-seat"
      data-testid={`seat-${expert.id}`}
      data-expert={expert.id}
      data-status={status}
      data-active={active}
      style={{ left: `${point.x}%`, top: `${point.y}%` }}
    >
      <div
        className={cn(
          "w-full overflow-hidden rounded-xl border px-2 py-1.5 text-center backdrop-blur-sm transition-colors",
          active ? "shadow-lg" : "shadow-sm",
          status === "finished" && "opacity-60",
        )}
        style={{
          background: "var(--color-seat)",
          borderColor: active ? color : "var(--color-line-1)",
          boxShadow: active
            ? `0 0 0 2px ${tint(color, 24)}, 0 12px 28px -18px ${color}`
            : undefined,
        }}
      >
        <span className="flex items-center justify-center gap-1">
          <span
            aria-hidden
            className="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold"
            style={{ background: tint(color, 26), color: readableInk(color) }}
          >
            {expert.name.slice(0, 1)}
          </span>
          {status === "speaking" && <SpeakingBars color={color} />}
        </span>

        <p
          className="mt-1 truncate text-[11px] font-semibold text-ink-1"
          title={expert.name}
        >
          {expert.name}
        </p>
        <p className="hidden w-full truncate text-[9px] text-ink-4 sm:block">
          {expert.title}
        </p>
        <div className="mt-0.5 flex justify-center">
          <StatusTag status={status} />
        </div>
        {focus && (
          <p
            className="mt-0.5 hidden w-full truncate text-[9px] text-ink-3 lg:block"
            title={focus}
          >
            {focus}
          </p>
        )}
      </div>
    </div>
  );
}

export function RoundTable({
  view,
  statuses,
  convergence,
  progress,
  now,
}: {
  view: SessionView;
  statuses: Map<string, ExpertStatus>;
  convergence: Convergence;
  progress: Progress;
  now?: number;
}) {
  const host = hostOf(view.roster);
  const experts = expertsOf(view.roster);
  const active = view.activeTurn;

  const statusOf = (id: string): ExpertStatus => statuses.get(id) ?? "idle";

  const focusOf = (id: string): string | null => {
    const expert = view.roster.find((e) => e.id === id);
    if (!expert) return null;
    if (active?.speakerId === id) return active.turnFocus || expert.focusArea;
    return expert.focusArea;
  };

  const activePoint: Point | null = (() => {
    if (!active) return null;
    if (host && active.speakerId === host.id) return seatPoint(0, experts.length, true);
    const index = experts.findIndex((e) => e.id === active.speakerId);
    return index < 0 ? null : seatPoint(index, experts.length, false);
  })();

  const activeColor = active
    ? safeColor(view.roster.find((e) => e.id === active.speakerId)?.color)
    : undefined;

  const clock =
    view.startedAt && now ? formatClock(now - Date.parse(view.startedAt)) : null;

  return (
    <section className="round-stage" data-testid="round-table" aria-label="圆桌席位">
      <div className="round-arena">
        <div
          className="round-table"
          style={
            activeColor
              ? ({ ["--speaker" as string]: activeColor } as CSSProperties)
              : undefined
          }
        />

        {activePoint && (
          <div
            className="round-spot"
            style={
              {
                ["--spot-x" as string]: `${activePoint.x}%`,
                ["--spot-y" as string]: `${activePoint.y}%`,
                ["--speaker" as string]: activeColor,
              } as CSSProperties
            }
          />
        )}

        <div className="round-center" data-testid="table-center">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-ink-4">
            争点
          </p>
          <p className="mt-0.5 text-[13px] leading-tight font-semibold text-ink-1 sm:text-sm">
            {convergence.label}
          </p>
          <p className="mt-0.5 text-[10px] text-ink-3">{convergence.detail}</p>
          <p className="mt-1.5 text-[10px] text-ink-4 tabular-nums">
            {view.messages.length === 0
              ? "等待主持人开场"
              : `第 ${progress.value} 轮 · 上限 ${progress.max}${clock ? ` · ${clock}` : ""}`}
          </p>
        </div>

        {host && (
          <Seat
            expert={host}
            status={statusOf(host.id)}
            active={active?.speakerId === host.id}
            focus={focusOf(host.id)}
            point={seatPoint(0, experts.length, true)}
          />
        )}

        {experts.map((expert, index) => (
          <Seat
            key={expert.id}
            expert={expert}
            status={statusOf(expert.id)}
            active={active?.speakerId === expert.id}
            focus={focusOf(expert.id)}
            point={seatPoint(index, experts.length, false)}
          />
        ))}
      </div>
    </section>
  );
}
