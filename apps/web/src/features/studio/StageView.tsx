import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layers, MessageSquare, Users } from "lucide-react";

import { ExpertList } from "../../components/ExpertList";
import { InsightPanel } from "../../components/InsightPanel";
import { LiveBar } from "../../components/PlaybackBar";
import { RoundTable } from "../../components/RoundTable";
import { StageHeader } from "../../components/StageHeader";
import { SummaryCard } from "../../components/SummaryCard";
import { Transcript } from "../../components/Transcript";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import {
  convergenceOf,
  deriveAllStatuses,
  progressOf,
} from "../../domain/selectors";
import { useNow, useStickyScroll } from "../../lib/useStickyScroll";
import { useReducedMotion } from "../../lib/useReducedMotion";
import { useStreamingFlags } from "../../lib/useStreamSnapshot";
import { useViewport } from "../../lib/useViewport";
import { useUiStore, type MobileTab } from "../../stores/uiStore";
import { useSession } from "./SessionProvider";

const TABS: Array<{ key: MobileTab; label: string; icon: typeof Users }> = [
  { key: "table", label: "圆桌", icon: Users },
  { key: "log", label: "实录", icon: MessageSquare },
  { key: "insights", label: "共识", icon: Layers },
];

export function StageView({
  onReplay,
  onBack,
}: {
  onReplay: (() => void) | null;
  onBack: () => void;
}) {
  const { view, buffer, connection, requestEnd } = useSession();
  const navigate = useNavigate();
  const viewport = useViewport();
  const reducedMotion = useReducedMotion();

  const sticky = useStickyScroll(reducedMotion);
  const live = view.status === "live" || view.status === "summarizing";
  const now = useNow(live);

  const { messageId: streamingMessageId, hasText } = useStreamingFlags(buffer);

  const mobileTab = useUiStore((state) => state.mobileTab);
  const setMobileTab = useUiStore((state) => state.setMobileTab);
  const drawerOpen = useUiStore((state) => state.insightDrawerOpen);
  const toggleDrawer = useUiStore((state) => state.toggleInsightDrawer);
  const setDrawerOpen = useUiStore((state) => state.setInsightDrawerOpen);

  const [expertsOpen, setExpertsOpen] = useState(false);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);

  // Below 1024 the three panels become tabs; from 1024 they are grid columns.
  const tabbed = viewport === "mobile" || viewport === "tablet";
  const isWide = viewport === "wide";

  const statuses = useMemo(
    () => deriveAllStatuses(view, streamingMessageId, hasText, now),
    [view, streamingMessageId, hasText, now],
  );
  const convergence = useMemo(() => convergenceOf(view), [view]);
  const progress = useMemo(() => progressOf(view), [view]);

  useEffect(() => {
    if (!highlightMessageId) return;
    const timer = window.setTimeout(() => setHighlightMessageId(null), 2400);
    if (tabbed) setMobileTab("log");
    document
      .querySelector(`[data-testid="message-${highlightMessageId}"]`)
      ?.scrollIntoView({
        block: "center",
        behavior: reducedMotion ? "auto" : "smooth",
      });
    return () => window.clearTimeout(timer);
  }, [highlightMessageId, reducedMotion, tabbed, setMobileTab]);

  useEffect(() => {
    if (isWide) setDrawerOpen(false);
  }, [isWide, setDrawerOpen]);

  const jumpToSummary = useCallback(() => {
    if (tabbed) setMobileTab("log");
    document.getElementById("summary-card")?.scrollIntoView({
      block: "start",
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, [reducedMotion, tabbed, setMobileTab]);

  const openTranscript = useCallback(() => setMobileTab("log"), [setMobileTab]);

  const doEnd = async () => {
    setConfirmEnd(false);
    setEnding(true);
    try {
      await requestEnd();
    } catch {
      /* provider reconciles via refresh */
    } finally {
      setEnding(false);
    }
  };

  const ended = view.status === "ended" || view.status === "failed";

  const liveBar = (
    <LiveBar
      inline={tabbed}
      turnCount={view.turnCount}
      maxTurns={view.maxTurns}
      status={view.status}
      insightCount={view.insights.length}
      sticky={sticky}
      visible
      onReplay={ended && onReplay ? onReplay : undefined}
    />
  );

  return (
    <>
      <div className="studio-shell" data-shell="live">
        <StageHeader
          view={view}
          connection={connection.state}
          insightCount={view.insights.length}
          expertCount={view.roster.length}
          onBack={onBack}
          onToggleExperts={() => setExpertsOpen((open) => !open)}
          onToggleInsights={isWide ? undefined : () => toggleDrawer()}
          onEnd={() => setConfirmEnd(true)}
          ending={ending}
          ended={ended}
          now={now}
        />

        <aside
          className="studio-log"
          data-tab-active={tabbed ? mobileTab === "log" : undefined}
        >
          <Transcript
            view={view}
            buffer={buffer}
            sticky={sticky}
            highlightMessageId={highlightMessageId}
            onSummaryJump={jumpToSummary}
            className="flex-1"
            footer={
              <SummaryCard summary={view.summary} status={view.status} now={now} />
            }
          />
          {tabbed && <div className="shrink-0">{liveBar}</div>}
        </aside>

        <div
          className="studio-table flex min-h-0 flex-col"
          data-tab-active={tabbed ? mobileTab === "table" : undefined}
        >
          <RoundTable
            view={view}
            buffer={buffer}
            statuses={statuses}
            convergence={convergence}
            progress={progress}
            now={now}
          />
          <ExpertList
            view={view}
            statuses={statuses}
            open={expertsOpen}
            onToggle={() => setExpertsOpen((open) => !open)}
          />
        </div>

        <aside
          className="studio-insights"
          data-open={drawerOpen}
          data-tab-active={tabbed ? mobileTab === "insights" : undefined}
        >
          <InsightPanel
            insights={view.insights}
            onEvidenceClick={setHighlightMessageId}
            onOpenTranscript={openTranscript}
            className="h-full"
          />
        </aside>

        {drawerOpen && !isWide && (
          <button
            type="button"
            aria-label="关闭共识面板"
            className="studio-scrim"
            onClick={() => setDrawerOpen(false)}
          />
        )}

        {!tabbed && liveBar}

        {tabbed && (
          <nav
            role="tablist"
            aria-label="演播厅视图"
            className="studio-tabbar flex h-14 items-stretch border-t border-line-1 bg-stage-950/95"
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const selected = mobileTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid={`tab-${tab.key}`}
                  onClick={() => setMobileTab(tab.key)}
                  className="studio-tab"
                >
                  <Icon className="size-4" aria-hidden />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {view.status === "failed" && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 md:bottom-24">
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-danger/40 bg-stage-850/95 px-4 py-2 text-[12px] text-danger shadow-xl backdrop-blur">
            <span>{view.failure?.message ?? "这场讨论中断了。"}</span>
            <Button size="sm" variant="ghost" onClick={() => navigate("/")}>
              返回大厅
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmEnd}
        title="结束这场讨论？"
        description="结束后不能再继续发言，但可以回看整场。主持人会先做一段总结。"
        confirmLabel="结束并总结"
        tone="danger"
        onConfirm={() => void doEnd()}
        onCancel={() => setConfirmEnd(false)}
      />
    </>
  );
}
