import type { StreamBuffer } from "../domain/streamBuffer";
import type { SessionView } from "../domain/session";
import type { ExpertStatus } from "../domain/selectors";
import { EXPERT_STATUS_LABEL } from "../domain/selectors";
import { ExpertCard } from "./ExpertCard";

/**
 * The collapsible expert list. Seats on the round table show the same status
 * text, so the list is a redundant-but-readable second view (docs/09 §4).
 */
export function ExpertList({
  view,
  statuses,
  open,
  onToggle,
}: {
  view: SessionView;
  statuses: Map<string, ExpertStatus>;
  open: boolean;
  onToggle: () => void;
}) {
  const speaking = [...statuses.values()].filter((s) => s === "speaking").length;

  return (
    <section
      className="shrink-0 border-t border-line-1"
      data-testid="expert-list"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid="toggle-expert-list"
        className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-stage-950/60"
      >
        <span className="text-[10px] font-semibold tracking-[0.16em] text-ink-4">
          专家列表
        </span>
        <span className="text-[10px] text-ink-4 tabular-nums">
          {view.roster.length}
        </span>
        {speaking > 0 && (
          <span className="text-[10px] text-live">
            {speaking} 人发言中
          </span>
        )}
        <span className="ml-auto text-[10px] text-ink-4">{open ? "收起" : "展开"}</span>
      </button>

      {open && (
        <div className="scroll-y max-h-44 px-3 pb-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {view.roster.map((expert) => (
              <ExpertCard
                key={expert.id}
                expert={expert}
                seat={expert.sortOrder}
                status={statuses.get(expert.id) ?? "idle"}
                turnFocus={view.activeTurn?.speakerId === expert.id ? view.activeTurn.turnFocus : null}
                active={view.activeTurn?.speakerId === expert.id}
              />
            ))}
          </div>
          <p className="mt-2 text-[10px] text-ink-4">
            状态说明：{Object.values(EXPERT_STATUS_LABEL).join(" / ")}
          </p>
        </div>
      )}
    </section>
  );
}
