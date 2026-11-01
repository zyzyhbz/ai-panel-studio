import { Play, Pause, RotateCcw, ArrowDown, Gauge } from "lucide-react";

import type { ReplaySpeed } from "../stores/uiStore";
import { cn } from "../lib/cn";
import { Button } from "./ui/Button";
import type { StickyScroll } from "../lib/useStickyScroll";

function TransportShell({
  children,
  inline = false,
}: {
  children: React.ReactNode;
  inline?: boolean;
}) {
  return (
    <footer
      data-testid="playback-bar"
      className={
        inline
          ? "flex h-12 shrink-0 items-center gap-3 border-t border-line-1 bg-stage-950/80 px-3"
          : "studio-footer relative z-10 h-14 shrink-0 items-center gap-3 border-t border-line-1 bg-stage-950/80 px-4 backdrop-blur-sm"
      }
    >
      {children}
    </footer>
  );
}

export function LiveBar({
  turnCount,
  maxTurns,
  insightCount,
  status,
  sticky,
  visible,
  onReplay,
  onTogglePause,
  inline = false,
}: {
  turnCount: number;
  maxTurns?: number;
  insightCount: number;
  status?: "generating" | "ready" | "live" | "summarizing" | "ended" | "failed";
  sticky: StickyScroll;
  visible: boolean;
  onReplay?: () => void;
  onTogglePause?: () => void;
  inline?: boolean;
}) {
  if (!visible) return null;
  const ended = status === "ended" || status === "failed";
  const label = ended ? "已结束" : status === "summarizing" ? "正在收尾" : "直播中";

  return (
    <TransportShell inline={inline}>
      <span className="flex items-center gap-2 text-[11px] text-ink-3">
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            ended ? "bg-ink-4" : "live-dot bg-live",
          )}
        />
        {label}
        <span className="text-ink-4">·</span>
        <span className="tabular-nums">第 {turnCount} 轮 / 上限 {maxTurns ?? 36}</span>
        <span className="text-ink-4">·</span>
        <span className="tabular-nums">{insightCount} 条洞察</span>
      </span>

      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={sticky.togglePause}
          aria-pressed={sticky.paused}
          data-testid="toggle-autoscroll"
        >
          {sticky.paused ? "恢复自动滚动" : "暂停自动滚动"}
        </Button>

        {!sticky.pinned && (
          <Button
            size="sm"
            variant="ghost"
            icon={<ArrowDown className="size-3.5" aria-hidden />}
            onClick={sticky.jumpToLatest}
          >
            跳到最新
          </Button>
        )}

        {onReplay && (
          <Button
            size="sm"
            variant="secondary"
            icon={<RotateCcw className="size-3.5" aria-hidden />}
            onClick={onReplay}
            data-testid="replay-cta"
          >
            回看整场
          </Button>
        )}
        {onTogglePause && !onReplay && (
          <span className="hidden text-[11px] text-ink-4 md:inline">自动跟随最新发言</span>
        )}
      </div>
    </TransportShell>
  );
}

export function ReplayBar({
  playing,
  ended,
  step,
  totalSteps,
  speed,
  chapterLabel,
  onToggle,
  onSpeed,
  onSeek,
  onRestart,
}: {
  playing: boolean;
  ended: boolean;
  step: number;
  totalSteps: number;
  speed: ReplaySpeed;
  chapterLabel: string;
  onToggle: () => void;
  onSpeed: (speed: ReplaySpeed) => void;
  onSeek: (step: number) => void;
  onRestart: () => void;
}) {
  const max = Math.max(0, totalSteps - 1);

  return (
    <TransportShell>      <Button
        size="sm"
        variant="primary"
        onClick={ended ? onRestart : onToggle}
        icon={
          ended ? (
            <RotateCcw className="size-3.5" aria-hidden />
          ) : playing ? (
            <Pause className="size-3.5" aria-hidden />
          ) : (
            <Play className="size-3.5" aria-hidden />
          )
        }
        data-testid="replay-toggle"
        aria-label={ended ? "重新播放" : playing ? "暂停" : "播放"}
      >
        <span className="hidden sm:inline">
          {ended ? "重播" : playing ? "暂停" : "播放"}
        </span>
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={Math.min(step, max)}
          onChange={(event) => onSeek(Number(event.target.value))}
          aria-label="回放进度"
          aria-valuetext={chapterLabel}
          data-testid="replay-slider"
          className="h-1.5 w-full min-w-0 cursor-pointer appearance-none rounded-full bg-line-1 accent-live"
          style={{
            background: `linear-gradient(to right, var(--color-live) ${
              max === 0 ? 0 : (Math.min(step, max) / max) * 100
            }%, var(--color-line-1) 0)`,
          }}
        />
        <span className="hidden shrink-0 text-[11px] text-ink-4 tabular-nums sm:inline">
          {chapterLabel}
        </span>
      </div>

      <div
        className="flex shrink-0 items-center gap-0.5 rounded-md border border-line-1 p-0.5"
        role="group"
        aria-label="播放速度"
      >
        <Gauge className="mx-1 size-3 text-ink-4" aria-hidden />
        {([1, 1.5, 2] as ReplaySpeed[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onSpeed(value)}
            aria-pressed={speed === value}
            data-testid={`replay-speed-${value}`}
            className={cn(
              "h-6 rounded-sm px-1.5 text-[11px] tabular-nums transition-colors",
              speed === value
                ? "bg-live text-stage-1000 font-semibold"
                : "text-ink-3 hover:text-ink-1",
            )}
          >
            {value}x
          </button>
        ))}
      </div>
    </TransportShell>
  );
}
