import { Layers, Square } from "lucide-react";

import type { ConnectionState } from "../api/sse";
import type { SessionView } from "../domain/session";
import { progressOf, STATUS_LABEL } from "../domain/selectors";
import { elapsedSince, formatRelative } from "../lib/time";
import { Button } from "./ui/Button";
import { SessionStatusPill, StatusPill } from "./ui/Pill";
import { ProgressMeter } from "./ui/Progress";

export function StageHeader({
  view,
  connection,
  insightCount,
  onToggleInsights,
  onEnd,
  ending,
  ended,
  now,
  replay,
}: {
  view: SessionView;
  connection?: ConnectionState;
  insightCount: number;
  onToggleInsights?: () => void;
  onEnd?: () => void;
  ending?: boolean;
  ended?: boolean;
  now?: number;
  replay?: boolean;
}) {
  const progress = progressOf(view);
  const clock = elapsedSince(view.startedAt, now ?? Date.now());
  const reconnecting =
    connection === "reconnecting" ||
    connection === "connecting" ||
    connection === "fatal" ||
    connection === "degraded";

  return (
    <header
      data-testid="stage-header"
      className="studio-header relative z-10 flex h-14 items-center gap-3 border-b border-line-1 bg-stage-950/70 px-4 backdrop-blur-sm md:h-16"
    >
      {replay ? (
        <StatusPill tone="replay" label="回放" />
      ) : (
        <SessionStatusPill status={view.status} />
      )}

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] font-semibold text-ink-1 md:text-base">
          {view.topic || "未命名议题"}
        </h1>
        <p className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-ink-4">
          {view.status === "live" && (
            <span className="text-ink-3">
              {view.plannedTurns > 0 ? progress.label : `${view.turnCount} 轮`}
            </span>
          )}
          {view.status === "ready" && <span>阵容待确认</span>}
          {view.status === "generating" && <span>正在召集嘉宾</span>}
          {view.status === "summarizing" && <span>主持人正在收尾</span>}
          {view.status === "ended" && (
            <span>
              已结束 · {view.turnCount} 轮 · {formatRelative(view.endedAt ?? undefined, now)}
            </span>
          )}
          {view.status === "failed" && <span>讨论已中断</span>}
          {reconnecting && !replay && (
            <span className="text-live">
              {connection === "degraded" ? "实时推送不可用，正在定时刷新" : "连接恢复中…"}
            </span>
          )}
        </p>
      </div>

      {/* Progress only where it means something. */}
      {!replay && (view.status === "live" || view.status === "summarizing") && (
        <div className="hidden items-center gap-3 md:flex">
          <ProgressMeter
            value={progress.value}
            max={progress.max}
            indeterminate={progress.indeterminate}
            label={progress.label}
          />
          {clock && (
            <span className="text-[11px] text-ink-3 tabular-nums">{clock}</span>
          )}
        </div>
      )}

      {onToggleInsights && (
        <Button
          size="sm"
          variant="ghost"
          icon={<Layers className="size-3.5" aria-hidden />}
          onClick={onToggleInsights}
          aria-label="打开共识与分歧"
          data-testid="insight-toggle"
        >
          <span className="hidden sm:inline">共识</span>
          <span className="tabular-nums">{insightCount}</span>
        </Button>
      )}

      {onEnd && !ended && (view.status === "live" || view.status === "summarizing") && (
        <Button
          size="sm"
          variant="secondary"
          loading={ending || view.status === "summarizing"}
          onClick={onEnd}
          data-testid="end-discussion"
        >
          <Square className="size-3" aria-hidden />
          {view.status === "summarizing" ? "收尾中" : "结束讨论"}
        </Button>
      )}
    </header>
  );
}

export function headerStatusText(view: SessionView): string {
  return STATUS_LABEL[view.status];
}
