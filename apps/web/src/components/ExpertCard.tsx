import type { Expert, Polarity } from "../api/types";
import type { ExpertStatus } from "../domain/selectors";
import { cn } from "../lib/cn";
import { readableInk, safeColor, tint } from "../lib/color";

const POLARITY_ORDER: Polarity[] = [
  "strong_oppose",
  "oppose",
  "neutral",
  "support",
  "strong_support",
];

const POLARITY_LABEL: Record<Polarity, string> = {
  strong_oppose: "强烈反对",
  oppose: "反对",
  neutral: "中立",
  support: "支持",
  strong_support: "强烈支持",
};

export function polarityLabel(polarity: Polarity | undefined): string {
  return polarity ? (POLARITY_LABEL[polarity] ?? "中立") : "中立";
}

/** Five-tick stance scale. Colour is never the only signal — the label is
 *  always rendered next to it. */
export function PolarityScale({
  polarity,
  color,
  className,
}: {
  polarity?: Polarity;
  color: string;
  className?: string;
}) {
  const index = Math.max(0, POLARITY_ORDER.indexOf(polarity ?? "neutral"));
  return (
    <span
      aria-hidden
      className={cn("inline-flex items-center gap-[2px]", className)}
    >
      {POLARITY_ORDER.map((step, i) => (
        <span
          key={step}
          className="h-2.5 w-[3px] rounded-full"
          style={{
            background: i <= index ? safeColor(color) : "var(--color-line-2)",
            opacity: i <= index ? 0.55 + i * 0.11 : 0.35,
          }}
        />
      ))}
    </span>
  );
}

const STATUS_LABEL: Record<ExpertStatus, string> = {
  idle: "待机",
  preparing: "准备发言",
  speaking: "发言中",
};

export function StatusDot({ status }: { status: ExpertStatus }) {
  if (status === "preparing") {
    return (
      <span
        aria-hidden
        className="preparing-ring size-1.5 shrink-0 rounded-full bg-live"
      />
    );
  }
  if (status === "speaking") {
    return (
      <span
        aria-hidden
        className="live-dot size-1.5 shrink-0 rounded-full bg-live"
      />
    );
  }
  return (
    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ink-4/70" />
  );
}

/** Three little bars — the strongest "someone is talking" cue we have
 *  without audio. Static (but still visible) under reduced motion. */
export function SpeakingBars({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="speaking-bars inline-flex h-3 items-end gap-[2px]"
      style={{ color: safeColor(color) }}
    >
      <span />
      <span />
      <span />
    </span>
  );
}

export interface ExpertCardProps {
  expert: Expert;
  status: ExpertStatus;
  seat: number;
  turnFocus?: string | null;
  active?: boolean;
  density?: "full" | "compact";
  onClick?: () => void;
  className?: string;
}

export function ExpertCard({
  expert,
  status,
  seat,
  turnFocus,
  active = false,
  density = "full",
  onClick,
  className,
}: ExpertCardProps) {
  const color = safeColor(expert.color);
  const isHost = expert.role === "host";

  if (density === "compact") {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={`expert-card-${expert.id}`}
        data-status={status}
        title={`${expert.name} · ${expert.title}`}
        className={cn(
          "group relative flex w-full flex-col items-center gap-1.5 rounded-lg px-1 py-2 transition-colors",
          active ? "bg-stage-850" : "hover:bg-stage-850/60",
          className,
        )}
        style={active ? { background: tint(color, 12) } : undefined}
      >
        <span className="relative">
          <span
            className="flex size-9 items-center justify-center rounded-full border text-xs font-semibold"
            style={{
              borderColor: color,
              color: readableInk(color),
              background: tint(color, 22),
            }}
          >
            {expert.name.slice(0, 1)}
          </span>
          <span className="absolute -right-0.5 -bottom-0.5 rounded-full bg-stage-900 p-[1px]">
            <StatusDot status={status} />
          </span>
        </span>
        <span className="text-[10px] text-ink-3">{seat}</span>
      </button>
    );
  }

  return (
    <div
      data-testid={`expert-card-${expert.id}`}
      data-status={status}
      className={cn(
        "relative overflow-hidden rounded-lg border px-3 py-2.5 transition-colors duration-200",
        active ? "bg-stage-850" : "border-line-1 bg-stage-900/40",
        className,
      )}
      style={{
        borderColor: active ? color : undefined,
        boxShadow: active ? `0 0 24px ${tint(color, 20)}` : undefined,
        background: active ? tint(color, 10) : undefined,
      }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: color, opacity: active ? 1 : 0.45 }}
      />

      <div className="flex items-center gap-2 pl-1">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
          style={{ background: tint(color, 22), color: readableInk(color) }}
        >
          {expert.name.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-ink-1">
              {expert.name}
            </span>
            {isHost && (
              <span className="shrink-0 rounded-sm border border-line-2 px-1 text-[9px] text-ink-3">
                主持
              </span>
            )}
          </span>
          <span className="block truncate text-[11px] text-ink-3">
            {expert.title}
          </span>
        </span>
        {status === "speaking" ? (
          <SpeakingBars color={color} />
        ) : (
          <StatusDot status={status} />
        )}
      </div>

      <div className="mt-2 space-y-1 pl-1">
        <div className="flex items-center gap-1.5">
          <PolarityScale polarity={expert.polarity} color={color} />
          <span className="truncate text-[10px] text-ink-4">
            {polarityLabel(expert.polarity)}
          </span>
        </div>
        <p className="line-clamp-2 text-[11px] leading-4 text-ink-3">
          {expert.stance}
        </p>
        <p className="truncate text-[10px] text-ink-4">
          {turnFocus && active ? (
            <span style={{ color }}>{turnFocus}</span>
          ) : (
            <>关注：{expert.focusArea}</>
          )}
        </p>
      </div>

      <p className="sr-only">{STATUS_LABEL[status]}</p>
    </div>
  );
}
