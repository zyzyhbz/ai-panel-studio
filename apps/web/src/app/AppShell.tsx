import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { StageBackdrop } from "../components/StageBackdrop";
import { cn } from "../lib/cn";

export function AppShell({
  children,
  actions,
  onHome = true,
}: {
  children: ReactNode;
  actions?: ReactNode;
  onHome?: boolean;
}) {
  return (
    <div className="relative grid h-dvh min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-stage-1000">
      <StageBackdrop />

      <header className="relative z-10 flex h-14 items-center gap-3 border-b border-line-1 bg-stage-950/60 px-4 backdrop-blur-sm md:h-16 md:px-6">
        {onHome ? (
          <Link to="/" className="group flex items-baseline gap-2">
            <span className="text-[13px] font-semibold tracking-[0.18em] text-ink-1 uppercase">
              AI Panel
            </span>
            <span className="text-[13px] font-light tracking-[0.18em] text-ink-4 uppercase group-hover:text-ink-3">
              Studio
            </span>
          </Link>
        ) : (
          <span className="text-[13px] font-semibold tracking-[0.18em] text-ink-1 uppercase">
            AI Panel Studio
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>

      <main className={cn("relative z-10 min-h-0 scroll-y")}>{children}</main>
    </div>
  );
}
