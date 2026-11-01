import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useReducedMotion } from "../../lib/useReducedMotion";
import { ArrowLeft, Layers, MessageSquare, Users } from "lucide-react";

import { friendlyMessage } from "../../api/client";
import { getAllEvents, getDiscussion } from "../../api/discussions";
import type { DiscussionDetail, PersistedEvent } from "../../api/types";
import { ExpertRail } from "../../components/ExpertRail";
import { InsightPanel } from "../../components/InsightPanel";
import { ReplayBar } from "../../components/PlaybackBar";
import { StageHeader } from "../../components/StageHeader";
import { SummaryCard } from "../../components/SummaryCard";
import { Transcript } from "../../components/Transcript";
import { Button } from "../../components/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/States";
import { reduceEvents } from "../../domain/reducer";
import { emptySession, type SessionView } from "../../domain/session";
import { StreamBuffer } from "../../domain/streamBuffer";
import { useStickyScroll } from "../../lib/useStickyScroll";
import { useViewport } from "../../lib/useViewport";
import { useUiStore, type MobileTab, type ReplaySpeed } from "../../stores/uiStore";

const MIN_STEP_MS = 150;
const MAX_STEP_MS = 2000;

const TABS: Array<{ key: MobileTab; label: string; icon: typeof Users }> = [
  { key: "discussion", label: "讨论", icon: MessageSquare },
  { key: "experts", label: "专家", icon: Users },
  { key: "insights", label: "共识", icon: Layers },
];

interface ReplayData {
  detail: DiscussionDetail;
  events: PersistedEvent[];
  base: SessionView;
}

function frameDelay(
  events: PersistedEvent[],
  cursor: number,
  speed: ReplaySpeed,
): number {
  const next = events[cursor];
  const prev = events[cursor - 1];
  if (!next) return 0;
  const nextAt = Date.parse(next.createdAt);
  const prevAt = prev ? Date.parse(prev.createdAt) : nextAt;
  const raw = Number.isFinite(nextAt) && Number.isFinite(prevAt) ? nextAt - prevAt : 0;
  const clamped = Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, raw));
  return Math.round(clamped / speed);
}

export function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const viewport = useViewport();
  const reducedMotion = useReducedMotion() ?? false;

  const [data, setData] = useState<ReplayData | null>(null);
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
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);

  const bufferRef = useRef<StreamBuffer | null>(null);
  if (bufferRef.current === null) bufferRef.current = new StreamBuffer();
  const buffer = bufferRef.current;

  const sticky = useStickyScroll(reducedMotion);
  const isMobile = viewport === "mobile";
  const isWide = viewport === "wide";

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([getDiscussion(id), getAllEvents(id)])
      .then(([detail, events]) => {
        if (cancelled) return;
        const status = detail.discussion.status;
        if (status !== "ended" && status !== "failed") {
          navigate(`/d/${id}`, { replace: true });
          return;
        }
        const base: SessionView = {
          ...emptySession(id),
          topic: detail.discussion.topic,
          expertCount: detail.discussion.expertCount,
          plannedTurns: detail.discussion.plannedTurns ?? 0,
          maxTurns: detail.discussion.maxTurns ?? 0,
        };
        setData({ detail, events, base });
        setCursor(events.length > 0 ? 1 : 0);
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

  const events = data?.events ?? [];

  const view = useMemo<SessionView>(() => {
    const base = data?.base ?? emptySession(id ?? "");
    return reduceEvents(base, events.slice(0, cursor));
  }, [data, events, cursor, id]);

  const totalTurns = useMemo(
    () => events.filter((event) => event.type === "message.completed").length,
    [events],
  );

  const atEnd = cursor >= events.length;

  useEffect(() => {
    if (!playing || !data) return;
    if (cursor >= events.length) {
      setPlaying(false);
      return;
    }
    const delay = frameDelay(events, cursor, speed);
    const timer = window.setTimeout(() => {
      setCursor((current) => Math.min(events.length, current + 1));
    }, Math.max(40, delay));
    return () => window.clearTimeout(timer);
  }, [playing, cursor, events, speed, data]);

  useEffect(() => {
    if (!highlightMessageId) return;
    const timer = window.setTimeout(() => setHighlightMessageId(null), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightMessageId]);

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

  if (error || !data) {
    return (
      <ErrorState
        title="无法打开回放"
        message={error ?? "这场讨论没有可回放的内容。"}
        action={
          <Link to="/">
            <Button>返回首页</Button>
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
            <Button>返回首页</Button>
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
        replay
        onToggleInsights={isWide ? undefined : () => toggleDrawer()}
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
            <SummaryCard summary={view.summary} status={view.status} />
          }
        />
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

      <ReplayBar
        playing={playing}
        ended={atEnd && !playing}
        step={Math.max(0, cursor - 1)}
        totalSteps={events.length}
        speed={speed}
        chapterLabel={`第 ${view.turnCount} / ${totalTurns} 轮`}
        onToggle={toggle}
        onSpeed={setSpeed}
        onSeek={(step) => seek(step + 1)}
        onRestart={restart}
      />

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

      <Link
        to="/"
        className="fixed top-4 left-4 z-40 hidden items-center gap-1.5 text-[11px] text-ink-3 transition-colors hover:text-ink-1 md:flex"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        首页
      </Link>
    </div>
  );
}
