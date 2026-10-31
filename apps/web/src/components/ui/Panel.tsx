import type { ReactNode, Ref } from "react";
import { cn } from "../../lib/cn";

export function Panel({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  return (
    <section
      className={cn("panel min-h-0 min-w-0 flex flex-col", className)}
      {...rest}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  meta,
  action,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex h-11 shrink-0 items-center gap-2 border-b border-line-1 px-4",
        className,
      )}
    >
      <h2 className="text-[11px] font-semibold tracking-[0.14em] text-ink-3">
        {title}
      </h2>
      {meta !== undefined && (
        <span className="text-[11px] text-ink-4 tabular-nums">{meta}</span>
      )}
      <div className="ml-auto flex items-center gap-1">{action}</div>
    </header>
  );
}

export function PanelBody({
  children,
  className,
  scroll = true,
  ref,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  scroll?: boolean;
  ref?: Ref<HTMLDivElement>;
  "data-testid"?: string;
  "aria-live"?: "polite" | "off";
}) {
  return (
    <div
      ref={ref}
      className={cn(
        "min-h-0 min-w-0 flex-1",
        scroll && "scroll-y overscroll-contain",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
