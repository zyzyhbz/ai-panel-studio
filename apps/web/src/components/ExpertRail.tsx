import type { StreamBuffer } from "../domain/streamBuffer";
import type { SessionView } from "../domain/session";
import { deriveExpertStatus, expertsOf, hostOf } from "../domain/selectors";
import { useStreamSnapshot } from "../lib/useStreamSnapshot";
import { ExpertCard } from "./ExpertCard";
import { Panel, PanelHeader } from "./ui/Panel";

export function ExpertRail({
  view,
  buffer,
  density = "full",
  onSelect,
}: {
  view: SessionView;
  buffer: StreamBuffer;
  density?: "full" | "compact";
  onSelect?: (expertId: string) => void;
}) {
  const snapshot = useStreamSnapshot(buffer);
  const streamingMessageId = snapshot?.messageId ?? null;
  const hasText = (snapshot?.accepted.length ?? 0) > 0;

  const host = hostOf(view.roster);
  const experts = expertsOf(view.roster);

  const statusOf = (expertId: string) =>
    deriveExpertStatus(view, expertId, streamingMessageId, hasText);

  return (
    <Panel aria-label="专家状态" data-testid="expert-rail">
      {density === "full" && (
        <PanelHeader title="席位" meta={`${view.roster.length} 人`} />
      )}
      <div className="scroll-y min-h-0 flex-1 px-2 py-2">
        {view.roster.length === 0 ? (
          <p className="px-2 py-4 text-[11px] leading-5 text-ink-4">
            阵容生成后会出现在这里。
          </p>
        ) : (
          <div className={density === "compact" ? "space-y-1" : "space-y-2"}>
            {host && (
              <div>
                {density === "full" && (
                  <p className="mb-1 px-1 text-[10px] font-semibold tracking-[0.14em] text-ink-4">
                    主持人
                  </p>
                )}
                <ExpertCard
                  expert={host}
                  seat={0}
                  status={statusOf(host.id)}
                  turnFocus={view.activeTurn?.turnFocus ?? null}
                  active={view.activeTurn?.speakerId === host.id}
                  density={density}
                  onClick={onSelect ? () => onSelect(host.id) : undefined}
                />
              </div>
            )}

            {experts.length > 0 && density === "full" && (
              <p className="mb-1 px-1 pt-1 text-[10px] font-semibold tracking-[0.14em] text-ink-4">
                专家
              </p>
            )}

            {experts.map((expert, index) => (
              <ExpertCard
                key={expert.id}
                expert={expert}
                seat={index + 1}
                status={statusOf(expert.id)}
                turnFocus={view.activeTurn?.turnFocus ?? null}
                active={view.activeTurn?.speakerId === expert.id}
                density={density}
                onClick={onSelect ? () => onSelect(expert.id) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
