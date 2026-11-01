import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Layers, MessageSquare, Users } from "lucide-react";

import { friendlyMessage } from "../../api/client";
import { getAllEvents, getDiscussion } from "../../api/discussions";
import type { DiscussionDetail, PersistedEvent } from "../../api/types";
import { ExpertList } from "../../components/ExpertList";
import { InsightPanel } from "../../components/InsightPanel";
import { ReplayBar } from "../../components/PlaybackBar";
import { RoundTable } from "../../components/RoundTable";
import { StageHeader } from "../../components/StageHeader";
import { SummaryCard } from "../../components/SummaryCard";
import { Transcript } from "../../components/Transcript";
import { Button } from "../../components/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/States";
import { reduceEvents } from "../../domain/reducer";
import { emptySession, type SessionView } from "../../domain/session";
import {
  convergenceOf,
  deriveAllStatuses,
  progressOf,
} from "../../domain/selectors";
import { StreamBuffer } from "../../domain/streamBuffer";
import { useReducedMotion } from "../../lib/useReducedMotion";
import { useStickyScroll } from "../../lib/useStickyScroll";
import { useViewport } from "../../lib/useViewport";
import { useUiStore, type MobileTab, type ReplaySpeed } from "../../stores/uiStore";

const MIN_STEP_MS = 150;
const MAX_STEP_MS = 2000;

const TABS: Array<{ key: MobileTab; label: string; icon: typeof Users }> = [
  { key: "table", label: "圆桌", icon: Users },
  { key: "log", label: "实录", icon: MessageSquare },
  { key: "insights", label: "共识", icon: Layers },
];

function frameDelay(events: PersistedEvent[], cursor: number, speed: ReplaySpeed): number {
  const next = events[cursor];
  const prev = events[cursor - 1];
  if (!next) return 0;
  const nextAt = Date.parse(next.createdAt);
  const prevAt = prev ? Date.parse(prev.createdAt) : nextAt;
  const raw = Number.isFinite(nextAt) && Number.isFinite(prevAt) ? nextAt - prevAt : 0;
  return Math.round(Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, raw)) / speed);
}

export function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const viewport = useViewport();
  const reducedMotion = useReducedMotion();

  const [detail, setDetail] = useState<DiscussionDetail | null>(null);
  const [events, setEvents] = useState<PersistedEvent[]>([]);
  const [base, setBase] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const speed = useUiStore((state) => state.replaySpeed);
  const setSpeed = useUiStore((state) => state.setReplaySpeed);
  const mobileTab = useUiStore((state) => state.mobileTab);
  const setMobileTab = useUiStore((state) => state.setMobileTab);
  const drawerOpen = useUiStore((state) => state.insightDrawerOpen);
  const toggleDrawer = useUiStore((state) => state.toggleInsightDrawer);
  const setDrawerOpen = useUiStore((state) => state.setInsightDrawerOpen);

  const [cursor, setCursor] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [expertsOpen, setExpertsOpen] = useState(false);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);

  const bufferRef = useRef<StreamBuffer | null>(null);
  if (bufferRef.current === null) bufferRef.current = new StreamBuffer();
  const buffer = bufferRef.current;

  const sticky = useStickyScroll(reducedMotion);
  const tabbed = viewport === "mobile" || viewport === "tablet";
  const isWide = viewport === "wide";

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([getDiscussion(id), getAllEvents(id)])
      .then(([loadedDetail, loadedEvents]) => {
        if (cancelled) return;
        const status = loadedDetail.discussion.status;
        if (status !== "ended" && status !== "failed") {
          navigate(`/d/${id}`, { replace: true });
          return;
        }
        setDetail(loadedDetail);
        setEvents(loadedEvents);
        setBase({
          ...emptySession(id),
          topic: loadedDetail.discussion.topic,
          expertCount: loadedDetail.discussion.expertCount,
          plannedTurns: loadedDetail.discussion.plannedTurns ?? 0,
          maxTurns: loadedDetail.discussion.maxTurns ?? 0,
        });
        setCursor(loadedEvents.length > 0 ? 1 : 0);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(friendlyMessage(cause));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  const view = useMemo<SessionView>(() => {
    const from = base ?? emptySession(id ?? "");
    return reduceEvents(from, events.slice(0, cursor));
  }, [base, events, cursor, id]);

  const atEnd = cursor >= events.length;

  useEffect(() => {
    if (!playing) return;
    if (cursor >= events.length) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setCursor((current) => Math.min(events.length, current + 1));
    }, Math.max(40, frameDelay(events, cursor, speed)));
    return () => window.clearTimeout(timer);
  }, [playing, cursor, events, speed]);

  useEffect(() => {
    if (!highlightMessageId) return;
    const timer = window.setTimeout(() => setHighlightMessageId(null), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightMessageId]);

  const statuses = useMemo(
    () => deriveAllStatuses(view, null, false, null, true),
    [view],
  );
  const convergence = useMemo(() => convergenceOf(view), [view]);
  const progress = useMemo(() => progressOf(view), [view]);

  const toggle = useCallback(() => {
    if (cursor >= events.length) {
      setCursor(0);
      setPlaying(true);
      return;
    }
    setPlaying((prev) => !prev);
  }, [cursor, events.length]);

  const restart = useCallback(() => {
    setCursor(0);
    setPlaying(true);
  }, []);

  const seek = useCallback((step: number) => {
    setCursor(step);
    setPlaying(false);
  }, []);

  const jumpToSummary = useCallback(() => {
    document.getElementById("summary-card")?.scrollIntoView({
      block: "start",
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }, [reducedMotion]);

  if (!id) return null;

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1080px] px-4 py-10">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="mt-4 h-5 w-2/3" />
        <div className="mt-8 space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <ErrorState
        title="无法打开回放"
        message={error ?? "这场讨论没有可回放的内容。"}
        action={
          <Link to="/">
            <Button>返回大厅</Button>
          </Link>
        }
      />
    );
  }

  if (events.length === 0) {
    return (
      <EmptyState
        title="这场讨论没有可回放的内容"
        description="事件日志为空，可能这场讨论在开始前就被中止了。"
        action={
          <Link to="/">
            <Button>返回大厅</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="studio-shell" data-shell="replay">
      <StageHeader
        view={view}
        insightCount={view.insights.length}
        expertCount={view.roster.length}
        replay
        onBack={() => navigate("/")}
        onToggleExperts={() => setExpertsOpen((open) => !open)}
        onToggleInsights={isWide ? undefined : () => toggleDrawer()}
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
          footer={<SummaryCard summary={view.summary} status={view.status} />}
        />
      </aside>

      <div
        className="studio-table flex min-h-0 flex-col"
        data-tab-active={tabbed ? mobileTab === "table" : undefined}
      >
        <RoundTable
          view={view}
          statuses={statuses}
          convergence={convergence}
          progress={progress}
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
          onOpenTranscript={() => setMobileTab("log")}
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

      <ReplayBar
        playing={playing}
        ended={atEnd && !playing}
        step={Math.max(0, cursor - 1)}
        totalSteps={events.length}
        speed={speed}
        chapterLabel={`第 ${view.turnCount} 轮`}
        onToggle={toggle}
        onSpeed={setSpeed}
        onSeek={(step) => seek(step + 1)}
        onRestart={restart}
      />

      {tabbed && (
        <nav
          role="tablist"
          aria-label="回放视图"
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
  );
}
