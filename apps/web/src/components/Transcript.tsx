import { useEffect, useMemo, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";

import type { Intent, Message } from "../api/types";
import type { StreamBuffer } from "../domain/streamBuffer";
import type { SessionView, TurnNotice } from "../domain/session";
import { abortLabel, INTENT_LABEL, speakerOf } from "../domain/selectors";
import { cn } from "../lib/cn";
import { safeColor } from "../lib/color";
import { formatBeat } from "../lib/time";
import type { StickyScroll } from "../lib/useStickyScroll";
import { useStreamSnapshot } from "../lib/useStreamSnapshot";
import { Button } from "./ui/Button";
import { Panel, PanelBody, PanelHeader } from "./ui/Panel";

function MetaRow({
  turnIndex,
  intent,
  createdAt,
  degraded,
}: {
  turnIndex: number;
  intent: Intent | string;
  createdAt?: string;
  degraded?: boolean;
}) {
  return (
    <span className="flex items-center gap-2 text-[10px] text-ink-4 tabular-nums">
      <span>#{turnIndex}</span>
      <span>{INTENT_LABEL[intent] ?? intent}</span>
      {degraded && (
        <span className="rounded-sm border border-line-2 px-1">降级</span>
      )}
      {createdAt && <span>{formatBeat(createdAt)}</span>}
    </span>
  );
}

export function MessageBubble({
  message,
  highlighted = false,
}: {
  message: Message;
  highlighted?: boolean;
}) {
  const color = safeColor(message.speakerColor);

  return (
    <article
      data-testid={`message-${message.id}`}
      className={cn(
        "msg-enter relative py-2 pl-3",
        highlighted && "insight-flash rounded-sm",
      )}
    >
      <span
        aria-hidden
        className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full"
        style={{ background: color, opacity: 0.85 }}
      />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-[12.5px] font-semibold" style={{ color }}>
          {message.speakerName}
        </span>
        <span className="text-[11px] text-ink-4">{message.speakerTitle}</span>
        <span className="ml-auto">
          <MetaRow
            turnIndex={message.turnIndex}
            intent={message.intent}
            createdAt={message.createdAt}
            degraded={message.degraded}
          />
        </span>
      </div>
      <p className="mt-1 text-[15px] leading-[25px] break-words text-ink-2">
        {message.content}
      </p>
    </article>
  );
}

function Caret({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[13px] w-[2px] translate-y-[2px] animate-pulse align-middle"
      style={{ background: color }}
    />
  );
}

export function StreamingBubble({
  view,
  buffer,
}: {
  view: SessionView;
  buffer: StreamBuffer;
}) {
  const snapshot = useStreamSnapshot(buffer);
  if (!snapshot) return null;

  const expert =
    speakerOf(view.roster, snapshot.speakerId) ??
    speakerOf(view.roster, view.activeTurn?.speakerId ?? "") ??
    null;
  const color = safeColor(expert?.color);
  const showPlaceholder = snapshot.text.length === 0;

  return (
    <article
      data-testid="streaming-bubble"
      className="relative py-2 pl-3"
      aria-live="off"
    >
      <span
        aria-hidden
        className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full"
        style={{ background: color, opacity: 0.85 }}
      />
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="text-[12.5px] font-semibold" style={{ color }}>
          {expert?.name ?? "…"}
        </span>
        <span className="text-[11px] text-ink-4">{expert?.title ?? ""}</span>
        {view.activeTurn && (
          <span className="ml-auto">
            <MetaRow
              turnIndex={view.activeTurn.turnIndex}
              intent={view.activeTurn.intent}
            />
          </span>
        )}
      </div>

      {showPlaceholder ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-4">
          <span className="inline-flex gap-1" aria-hidden>
            <span className="size-1 animate-pulse rounded-full bg-ink-4" />
            <span className="size-1 animate-pulse rounded-full bg-ink-4 [animation-delay:150ms]" />
            <span className="size-1 animate-pulse rounded-full bg-ink-4 [animation-delay:300ms]" />
          </span>
          正在组织发言
        </p>
      ) : (
        <p className="mt-1 text-[15px] leading-[25px] break-words text-ink-2">
          <span className="sr-only">{expert?.name} 正在发言：</span>
          {snapshot.text}
          <Caret color={color} />
        </p>
      )}
    </article>
  );
}

export function TurnNoticeLine({
  speakerName,
  reason,
  turnIndex,
}: {
  speakerName: string | null;
  reason: string;
  turnIndex: number;
}) {
  return (
    <div
      data-testid="turn-notice"
      className="my-1 flex items-center gap-2 rounded-sm border border-line-1 bg-stage-900/60 px-2.5 py-1.5 text-[11px] text-ink-4"
    >
      <span aria-hidden className="size-1 shrink-0 rounded-full bg-ink-4" />
      <span className="truncate">
        {speakerName ? `${speakerName} · ` : ""}
        {abortLabel(reason)}
      </span>
      <span className="ml-auto tabular-nums">#{turnIndex}</span>
    </div>
  );
}

export function JumpToLatest({
  unread,
  onClick,
}: {
  unread: number;
  onClick: () => void;
}) {
  const label = unread > 0 ? `${unread} 条新发言` : "跳到最新";
  return (
    <button
      type="button"
      data-testid="jump-to-latest"
      onClick={onClick}
      className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-live/40 bg-stage-850/95 px-3 py-1.5 text-[11px] font-medium text-live shadow-lg backdrop-blur transition-colors hover:bg-stage-800"
    >
      <ArrowDown className="size-3" aria-hidden />
      {label}
    </button>
  );
}

interface Row {
  turnIndex: number;
  message?: Message;
  notice?: TurnNotice;
}

export function Transcript({
  view,
  buffer,
  sticky,
  highlightMessageId,
  onSummaryJump,
  footer,
  className,
}: {
  view: SessionView;
  buffer: StreamBuffer;
  sticky: StickyScroll;
  highlightMessageId?: string | null;
  onSummaryJump?: () => void;
  footer?: ReactNode;
  className?: string;
}) {
  const count = view.messages.length;
  const snapshot = useStreamSnapshot(buffer);
  const streamingId = snapshot?.messageId ?? null;
  const summary = view.summary?.content ?? null;

  useEffect(() => {
    sticky.notifyContent();
    // Only content changes should re-evaluate stickiness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, streamingId, summary, view.status]);

  const rows = useMemo<Row[]>(() => {
    const byTurn = new Map<number, Row>();
    for (const message of view.messages) {
      byTurn.set(message.turnIndex, { turnIndex: message.turnIndex, message });
    }
    for (const notice of view.notices) {
      const existing = byTurn.get(notice.turnIndex);
      if (existing) existing.notice = notice;
      else byTurn.set(notice.turnIndex, { turnIndex: notice.turnIndex, notice });
    }
    return [...byTurn.values()].sort((a, b) => a.turnIndex - b.turnIndex);
  }, [view.messages, view.notices]);

  const body: ReactNode[] = useMemo(() => {
    const nodes: ReactNode[] = [];
    for (const row of rows) {
      if (row.message) {
        nodes.push(
          <MessageBubble
            key={row.message.id}
            message={row.message}
            highlighted={highlightMessageId === row.message.id}
          />,
        );
      }
      if (row.notice) {
        nodes.push(
          <TurnNoticeLine
            key={`n-${row.notice.turnIndex}-${row.notice.reason}`}
            speakerName={row.notice.speakerName}
            reason={row.notice.reason}
            turnIndex={row.notice.turnIndex}
          />,
        );
      }
    }
    return nodes;
  }, [rows, highlightMessageId]);

  const isWaiting =
    view.messages.length === 0 &&
    view.status !== "ended" &&
    view.status !== "failed";

  return (
    <Panel aria-label="现场实录" className={cn("relative", className)}>
      <PanelHeader
        title="现场实录"
        meta={view.messages.length > 0 ? `${view.messages.length} 条` : undefined}
        action={
          onSummaryJump && view.summary ? (
            <Button size="sm" variant="ghost" onClick={onSummaryJump}>
              跳到总结
            </Button>
          ) : undefined
        }
      />

      <div className="relative min-h-0 flex-1">
        <PanelBody
          ref={sticky.ref}
          data-testid="transcript"
          aria-live="polite"
          className="edge-fade h-full px-4 py-3"
        >
          {isWaiting && (
            <p className="mt-10 text-center text-[13px] text-ink-4">
              {view.status === "summarizing"
                ? "主持人正在收尾…"
                : "主持人即将开场…"}
            </p>
          )}

          <div className="mx-auto max-w-[860px]">
            {body}
            {streamingId && <StreamingBubble view={view} buffer={buffer} />}
            {footer}
          </div>

          <div className="mx-auto max-w-[860px]">
            {view.status === "ended" &&
              view.messages.length === 0 &&
              !view.summary && (
                <p className="mt-10 text-center text-[13px] text-ink-4">
                  这场讨论没有产生任何发言。
                </p>
              )}
          </div>

          <div className="h-4" aria-hidden />
        </PanelBody>

        {!sticky.pinned && (
          <JumpToLatest unread={sticky.unread} onClick={sticky.jumpToLatest} />
        )}
      </div>
    </Panel>
  );
}
