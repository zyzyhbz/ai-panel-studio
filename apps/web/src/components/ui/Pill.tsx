import type { DiscussionStatus } from "../../api/types";
import { STATUS_LABEL } from "../../domain/selectors";
import { cn } from "../../lib/cn";

export type PillTone =
  | "live"
  | "generating"
  | "ready"
  | "summarizing"
  | "ended"
  | "failed"
  | "replay"
  | "muted";

const TONES: Record<PillTone, { text: string; dot: string; ring: string }> = {
  live: { text: "text-live", dot: "bg-live", ring: "border-live/35" },
  generating: {
    text: "text-live",
    dot: "bg-live",
    ring: "border-live/25",
  },
  ready: { text: "text-ink-2", dot: "bg-ink-2", ring: "border-line-2" },
  summarizing: {
    text: "text-live",
    dot: "bg-live",
    ring: "border-live/25",
  },
  ended: { text: "text-ink-3", dot: "bg-ink-4", ring: "border-line-1" },
  failed: { text: "text-danger", dot: "bg-danger", ring: "border-danger/35" },
  replay: { text: "text-open", dot: "bg-open", ring: "border-open/30" },
  muted: { text: "text-ink-3", dot: "bg-ink-4", ring: "border-line-1" },
};

export function toneForStatus(status: DiscussionStatus): PillTone {
  switch (status) {
    case "live":
      return "live";
    case "generating":
      return "generating";
    case "ready":
      return "ready";
    case "summarizing":
      return "summarizing";
    case "ended":
      return "ended";
    case "failed":
      return "failed";
    default:
      return "muted";
  }
}

export function StatusPill({
  tone,
  label,
  pulse = false,
  className,
  testId = "status-pill",
}: {
  tone: PillTone;
  label: string;
  pulse?: boolean;
  className?: string;
  testId?: string;
}) {
  const colors = TONES[tone];
  return (
    <span
      role="status"
      data-testid={testId}
      data-tone={tone}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold tracking-[0.08em]",
        colors.text,
        colors.ring,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          colors.dot,
          pulse && "live-dot",
        )}
      />
      {label}
    </span>
  );
}

export function SessionStatusPill({
  status,
  override,
}: {
  status: DiscussionStatus;
  override?: string;
}) {
  return (
    <StatusPill
      tone={toneForStatus(status)}
      label={override ?? STATUS_LABEL[status]}
      pulse={status === "live" || status === "summarizing" || status === "generating"}
    />
  );
}
