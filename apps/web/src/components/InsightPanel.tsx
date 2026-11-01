import { useEffect, useMemo, useRef, useState } from "react";
import { CircleHelp, GitBranch, Handshake, type LucideIcon } from "lucide-react";

import type { Insight, InsightType } from "../api/types";
import { groupInsights } from "../domain/selectors";
import { cn } from "../lib/cn";
import { Panel, PanelHeader } from "./ui/Panel";

const SECTIONS: Array<{
  type: InsightType;
  key: "consensus" | "divergence" | "openQuestion";
  label: string;
  icon: LucideIcon;
  tone: string;
  empty: string;
}> = [
  {
    type: "consensus",
    key: "consensus",
    label: "共识",
    icon: Handshake,
    tone: "text-consensus",
    empty: "讨论刚开始，还没有形成共识",
  },
  {
    type: "divergence",
    key: "divergence",
    label: "分歧",
    icon: GitBranch,
    tone: "text-divergence",
    empty: "目前没有明显对立",
  },
  {
    type: "open_question",
    key: "openQuestion",
    label: "待验证",
    icon: CircleHelp,
    tone: "text-open",
    empty: "还没有未决问题",
  },
];

/**
 * Highlights only entries whose content actually changed. The contract says
 * `updatedAt` must only advance when that entry changed (decision I-7); we
 * additionally debounce on `content` so a sloppy server cannot make the whole
 * panel flash on every snapshot.
 */
function useInsightDiff(insights: Insight[]): Set<string> {
  const previous = useRef<Map<string, string> | null>(null);
  const [flash, setFlash] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const next = new Map<string, string>();
    for (const insight of insights) {
      next.set(insight.id, `${insight.updatedAt}|${insight.content}`);
    }

    const first = previous.current === null;
    const changed = new Set<string>();
    if (!first) {
      for (const [id, signature] of next) {
        if (previous.current?.get(id) !== signature) changed.add(id);
      }
    }
    previous.current = next;

    if (changed.size === 0) return;
    setFlash(changed);
    const timer = window.setTimeout(() => setFlash(new Set()), 1800);
    return () => window.clearTimeout(timer);
  }, [insights]);

  return flash;
}

function EvidenceChips({
  ids,
  onEvidenceClick,
}: {
  ids: string[];
  onEvidenceClick?: (messageId: string) => void;
}) {
  if (ids.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => onEvidenceClick?.(ids[0])}
      className="mt-1 inline-flex items-center gap-1 rounded-sm border border-line-1 px-1.5 py-0.5 text-[10px] text-ink-4 transition-colors hover:border-line-2 hover:text-ink-2"
    >
      依据 {ids.length} 条
    </button>
  );
}

function InsightItem({
  insight,
  tone,
  flashing,
  onEvidenceClick,
}: {
  insight: Insight;
  tone: string;
  flashing: boolean;
  onEvidenceClick?: (messageId: string) => void;
}) {
  return (
    <li
      data-testid={`insight-${insight.type}-${insight.id}`}
      className={cn(
        "rounded-md border border-transparent px-2 py-1.5",
        flashing && "insight-flash border-line-1",
      )}
    >
      <p className="text-[12.5px] leading-5 text-ink-2">{insight.content}</p>
      <div className="flex items-center gap-2">
        <span className={cn("text-[10px]", tone)}>
          {insight.firstSeenTurn ? `第 ${insight.firstSeenTurn} 轮起` : ""}
        </span>
        <EvidenceChips ids={insight.evidenceMessageIds} onEvidenceClick={onEvidenceClick} />
      </div>
    </li>
  );
}

export function InsightPanel({
  insights,
  onEvidenceClick,
  className,
}: {
  insights: Insight[];
  onEvidenceClick?: (messageId: string) => void;
  className?: string;
}) {
  const groups = useMemo(() => groupInsights(insights), [insights]);
  const flashing = useInsightDiff(insights);
  const total = insights.length;

  return (
    <Panel aria-label="共识与分歧" className={className}>
      <PanelHeader title="共识 · 分歧 · 待验证" meta={total > 0 ? `${total}` : undefined} />
      <div className="scroll-y min-h-0 flex-1 px-2 py-2">
        {total === 0 && (
          <p className="px-2 py-6 text-center text-[11px] leading-5 text-ink-4">
            讨论进行到第 2 轮后，这里会开始出现实时提炼的共识与分歧。
          </p>
        )}

        {total > 0 &&
          SECTIONS.map((section) => {
            const items = groups[section.key];
            const Icon = section.icon;
            return (
              <section key={section.type} className="mb-3 last:mb-0">
                <h3 className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-semibold tracking-[0.14em] text-ink-4">
                  <Icon className={cn("size-3", section.tone)} aria-hidden />
                  <span>{section.label}</span>
                  <span className="tabular-nums">{items.length}</span>
                </h3>
                {items.length === 0 ? (
                  <p className="px-2 py-1 text-[11px] text-ink-4/80">
                    {section.empty}
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {items.map((insight) => (
                      <InsightItem
                        key={insight.id}
                        insight={insight}
                        tone={section.tone}
                        flashing={flashing.has(insight.id)}
                        onEvidenceClick={onEvidenceClick}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
      </div>
    </Panel>
  );
}
