import { Quote } from "lucide-react";

import type { DiscussionStatus, Summary } from "../api/types";
import { formatRelative } from "../lib/time";

/**
 * The host's closing remark, rendered as a caption card — plain text only.
 * Contract §1.10: message/summary content is plain text, never markdown/HTML.
 */
export function SummaryCard({
  summary,
  status,
  now,
  anchorId = "summary-card",
}: {
  summary: Summary | null;
  /** Any session status; the card only renders for terminal states. */
  status: DiscussionStatus;
  now?: number;
  anchorId?: string;
}) {
  if (status !== "ended" && status !== "failed") return null;

  return (
    <section
      id={anchorId}
      data-testid="summary-card"
      className="mt-4 rounded-lg border border-line-1 bg-stage-900/70 p-4"
    >
      <header className="mb-2 flex items-center gap-2">
        <Quote className="size-3.5 text-live" aria-hidden />
        <h2 className="text-[11px] font-semibold tracking-[0.14em] text-ink-3">
          主持人总结
        </h2>
        {summary && (
          <span className="ml-auto text-[10px] text-ink-4">
            {formatRelative(summary.createdAt, now)}
          </span>
        )}
      </header>

      {summary ? (
        <>
          <p className="text-[14px] leading-7 whitespace-pre-line text-ink-1">
            {summary.content}
          </p>
          {summary.isFallback && (
            <p className="mt-2 text-[10px] text-ink-4">
              本次总结由模板生成（模型未返回可用内容）。
            </p>
          )}
        </>
      ) : status === "failed" ? (
        <p className="text-[12.5px] leading-6 text-ink-4">
          讨论中断，没有生成总结。已产生的发言仍可回看。
        </p>
      ) : (
        <p className="text-[12.5px] leading-6 text-ink-4">
          这场讨论没有生成总结。
        </p>
      )}
    </section>
  );
}
