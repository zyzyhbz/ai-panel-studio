import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useReducedMotion } from "../../lib/useReducedMotion";
import { Layers, MessageSquare, Users } from "lucide-react";

import { ExpertRail } from "../../components/ExpertRail";
import { InsightPanel } from "../../components/InsightPanel";
import { LiveBar } from "../../components/PlaybackBar";
import { StageHeader } from "../../components/StageHeader";
import { SummaryCard } from "../../components/SummaryCard";
import { Transcript } from "../../components/Transcript";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { useNow, useStickyScroll } from "../../lib/useStickyScroll";
import { useViewport } from "../../lib/useViewport";
import { useUiStore, type MobileTab } from "../../stores/uiStore";
import { useSession } from "./SessionProvider";

const TABS: Array<{ key: MobileTab; label: string; icon: typeof Users }> = [
  { key: "discussion", label: "讨论", icon: MessageSquare },
  { key: "experts", label: "专家", icon: Users },
  { key: "insights", label: "共识", icon: Layers },
];

export function StageView({ onReplay }: { onReplay: (() => void) | null }) {
  const { view, buffer, connection, requestEnd } = useSession();
  const navigate = useNavigate();
  const viewport = useViewport();
  const reducedMotion = useReducedMotion() ?? false;

  const sticky = useStickyScroll(reducedMotion);
  const now = useNow(view.status === "live" || view.status === "summarizing");

  const mobileTab = useUiStore((state) => state.mobileTab);
  const setMobileTab = useUiStore((state) => state.setMobileTab);
  const drawerOpen = useUiStore((state) => state.insightDrawerOpen);
  const toggleDrawer = useUiStore((state) => state.toggleInsightDrawer);
  const setDrawerOpen = useUiStore((state) => state.setInsightDrawerOpen);

  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);

  const isWide = viewport === "wide";
  const isMobile = viewport === "mobile";

  useEffect(() => {
    if (!highlightMessageId) return;
    const timer = window.setTimeout(() => setHighlightMessageId(null), 2400);
    const node = document.querySelector(
      `[data-testid="message-${highlightMessageId}"]`,
    );
    node?.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
    return () => window.clearTimeout(timer);
  }, [highlightMessageId, reducedMotion]);

  useEffect(() => {
    if (isWide) setDrawerOpen(false);
  }, [isWide, setDrawerOpen]);

  const jumpToSummary = useCallback(() => {
    document.getElementById("summary-card")?.scrollIntoView({
      block: "start",
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, [reducedMotion]);

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

  return (
    <>
      <div className="studio-shell" data-shell="live">
        <StageHeader
          view={view}
          connection={connection.state}
          insightCount={view.insights.length}
          onToggleInsights={isWide ? undefined : () => toggleDrawer()}
          onEnd={() => setConfirmEnd(true)}
          ending={ending}
          ended={ended}
          now={now}
        />

        <aside
          className="studio-rail"
          data-tab-active={isMobile ? mobileTab === "experts" : undefined}
        >
          <ExpertRail
            view={view}
            buffer={buffer}
            density={viewport === "tablet" ? "compact" : "full"}
          />
        </aside>

        <div
          className="studio-stage flex min-h-0 flex-col"
          data-tab-active={isMobile ? mobileTab === "discussion" : undefined}
        >
          <Transcript
            view={view}
            buffer={buffer}
            sticky={sticky}
            highlightMessageId={highlightMessageId}
            onSummaryJump={jumpToSummary}
            className="flex-1"
            footer={
              <SummaryCard
                summary={view.summary}
                status={view.status}
                now={now}
              />
            }
          />

          {isMobile && (
            <LiveBar
              inline
              turnCount={view.turnCount}
              insightCount={view.insights.length}
              sticky={sticky}
              visible
              onReplay={ended && onReplay ? onReplay : undefined}
            />
          )}
        </div>

        <aside
          className="studio-insights"
          data-open={drawerOpen}
          data-tab-active={isMobile ? mobileTab === "insights" : undefined}
        >
          <InsightPanel
            insights={view.insights}
            onEvidenceClick={setHighlightMessageId}
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

        {!isMobile && (
          <LiveBar
            turnCount={view.turnCount}
            insightCount={view.insights.length}
            sticky={sticky}
            visible
            onReplay={ended && onReplay ? onReplay : undefined}
          />
        )}

        {isMobile && (
          <nav role="tablist" aria-label="演播厅视图" className="studio-tabbar flex h-14 items-stretch border-t border-line-1 bg-stage-950/95">
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
              返回首页
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
