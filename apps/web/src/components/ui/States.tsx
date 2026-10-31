import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-md bg-stage-850",
        className,
      )}
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
  testId,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      {icon !== undefined && <div className="text-ink-4">{icon}</div>}
      <p className="text-sm font-medium text-ink-1">{title}</p>
      {description !== undefined && (
        <p className="max-w-sm text-xs leading-relaxed text-ink-3">
          {description}
        </p>
      )}
      {action !== undefined && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "鍑轰簡鐐归棶棰?,
  message,
  action,
  className,
  testId = "error-state",
}: {
  title?: string;
  message: string;
  action?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      role="alert"
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      <div
        aria-hidden
        className="flex size-9 items-center justify-center rounded-full border border-danger/35 text-danger"
      >
        !
      </div>
      <p className="text-sm font-medium text-ink-1">{title}</p>
      <p className="max-w-sm text-xs leading-relaxed text-ink-3">{message}</p>
      {action !== undefined && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function InlineError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-danger/35 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger"
    >
      {message}
    </p>
  );
}

export function Banner({
  tone = "muted",
  children,
  action,
  testId,
}: {
  tone?: "muted" | "live" | "danger";
  children: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  const palette = {
    muted: "border-line-1 bg-stage-850 text-ink-2",
    live: "border-live/30 bg-live/10 text-live",
    danger: "border-danger/35 bg-danger/10 text-danger",
  }[tone];

  return (
    <div
      data-testid={testId}
      className={cn(
        "flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs",
        palette,
      )}
    >
      {children}
      {action !== undefined && <div className="ml-auto">{action}</div>}
    </div>
  );
}
