import { cn } from "../../lib/cn";

/**
 * Turn progress. When the server never sends a denominator we render an
 * indeterminate strip rather than inventing a percentage (API gap F-23).
 */
export function ProgressMeter({
  value,
  max,
  indeterminate = false,
  label,
  className,
}: {
  value: number;
  max: number;
  indeterminate?: boolean;
  label?: string;
  className?: string;
}) {
  const safeMax = max > 0 ? max : 0;
  const ratio = safeMax > 0 ? Math.min(1, value / safeMax) : 0;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={indeterminate ? undefined : safeMax}
        aria-valuenow={indeterminate ? undefined : value}
        aria-valuetext={label}
        className="relative h-1 w-16 overflow-hidden rounded-full bg-line-1"
      >
        {indeterminate ? (
          <span className="absolute inset-y-0 left-0 w-1/3 animate-pulse rounded-full bg-live/60" />
        ) : (
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-live/80 transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(4, ratio * 100)}%` }}
          />
        )}
      </div>
      {label !== undefined && (
        <span className="text-[11px] text-ink-3 tabular-nums">{label}</span>
      )}
    </div>
  );
}
