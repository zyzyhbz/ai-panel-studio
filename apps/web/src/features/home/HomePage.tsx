import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, RotateCw } from "lucide-react";

import { friendlyMessage } from "../../api/client";
import { listDiscussions } from "../../api/discussions";
import type { DiscussionListItem } from "../../api/types";
import { excerpt } from "../../domain/selectors";
import { cn } from "../../lib/cn";
import { formatRelative } from "../../lib/time";
import { Button } from "../../components/ui/Button";
import { SessionStatusPill } from "../../components/ui/Pill";
import { ProgressMeter } from "../../components/ui/Progress";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/States";

const POLL_MS = 5000;

const SAMPLE_TOPICS = [
  "AI 会不会让初级开发者失业？",
  "远程办公会削弱团队创造力吗？",
  "开源模型的商业化路径在哪里？",
];

type Group = "active" | "ended" | "failed";

function groupOf(item: DiscussionListItem): Group {
  if (item.status === "failed") return "failed";
  if (item.status === "ended") return "ended";
  return "active";
}

function ctaLabel(item: DiscussionListItem): string {
  switch (item.status) {
    case "live":
    case "summarizing":
      return "进入演播厅";
    case "ready":
      return "确认阵容";
    case "generating":
      return "生成中…";
    case "ended":
      return "观看回放";
    case "failed":
      return "查看";
    default:
      return "打开";
  }
}

function hrefFor(item: DiscussionListItem): string {
  return item.status === "ended" ? `/d/${item.id}/replay` : `/d/${item.id}`;
}

function AvatarStack({ item }: { item: DiscussionListItem }) {
  const people = item.experts ?? [];
  const shown = people.slice(0, 4);
  const rest = Math.max(0, (item.expertCount || people.length) - shown.length);

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex -space-x-2">
        {shown.map((expert) => (
          <span
            key={expert.id}
            title={expert.name}
            className="flex size-6 items-center justify-center rounded-full border text-[10px] font-semibold"
            style={{
              borderColor: expert.color,
              background: `color-mix(in oklab, ${expert.color} 24%, #0b0f15)`,
              color: "#edf1f7",
            }}
          >
            {expert.name.slice(0, 1)}
          </span>
        ))}
      </div>
      <span className="text-[11px] text-ink-4">
        {item.hostName ? `主持人 ${item.hostName}` : ""}
        {rest > 0 ? ` · 共 ${item.expertCount} 位专家` : ""}
      </span>
    </div>
  );
}

function DiscussionCard({ item, now }: { item: DiscussionListItem; now: number }) {
  const max = item.maxTurns ?? 36;
  const progressLabel =
    max > 0 ? `${item.turnCount} / 上限 ${max} 轮` : `${item.turnCount} 轮`;

  return (
    <Link
      to={hrefFor(item)}
      data-testid="discussion-card"
      className={cn(
        "group relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-line-1 bg-stage-900/50 p-4",
        "transition-colors duration-200 hover:border-line-2 hover:bg-stage-850/70",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px] bg-ink-4/40 group-hover:bg-live/70"
      />

      <div className="flex items-start gap-2">
        <SessionStatusPill status={item.status} />
        <span className="ml-auto shrink-0 text-[10px] text-ink-4 tabular-nums">
          {formatRelative(item.updatedAt, now)}
        </span>
      </div>

      <h3 className="line-clamp-2 text-[15px] leading-6 font-medium text-ink-1">
        {item.topic}
      </h3>

      {item.status === "ended" && item.summaryPreview ? (
        <p className="line-clamp-2 text-[12px] leading-5 text-ink-3">
          {excerpt(item.summaryPreview, 80)}
        </p>
      ) : item.status === "failed" ? (
        <p className="text-[12px] leading-5 text-danger">
          生成失败{item.errorCode ? `（${item.errorCode}）` : ""}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        <AvatarStack item={item} />
        <span className="ml-auto flex items-center gap-2">
          <ProgressMeter
            value={item.turnCount}
            max={max}
            indeterminate={max === 0}
            label={progressLabel}
          />
        </span>
      </div>

      <div className="flex items-center justify-between border-t border-line-1 pt-2">
        <span className="text-[11px] text-ink-4">
          {item.expertCount} 位专家 · {item.turnCount} 轮发言
        </span>
        <span className="text-[11px] font-medium text-live opacity-0 transition-opacity group-hover:opacity-100">
          {ctaLabel(item)} →
        </span>
      </div>
    </Link>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-line-1 bg-stage-900/40 p-4">
      <Skeleton className="h-5 w-16" />
      <Skeleton className="mt-3 h-5 w-full" />
      <Skeleton className="mt-2 h-5 w-3/4" />
      <Skeleton className="mt-4 h-4 w-40" />
    </div>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<DiscussionListItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await listDiscussions({ status: "all", limit: 50, signal });
      setItems(data.items ?? []);
      setStatus("ready");
      setError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(friendlyMessage(cause));
      // Keep the list on screen if we already had one — a failed poll should
      // not blank the page.
      setStatus((prev) => (prev === "ready" ? "ready" : "error"));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    let timer: number | null = null;

    const tick = () => {
      if (document.visibilityState === "visible") void load();
      setNow(Date.now());
    };

    timer = window.setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const active = items.filter((item) => groupOf(item) === "active");
  const ended = items.filter((item) => groupOf(item) === "ended");
  const failed = items.filter((item) => groupOf(item) === "failed");

  const retry = () => {
    setStatus("loading");
    void load();
  };

  if (status === "loading" && items.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1180px] px-4 py-6 md:px-8">
        <Skeleton className="h-8 w-64" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  if (status === "error" && items.length === 0) {
    return (
      <div className="mx-auto flex h-full w-full max-w-[1180px] flex-col px-4 md:px-8">
        <ErrorState
          title="首页加载失败"
          message={error ?? "无法获取讨论列表。"}
          action={
            <div className="flex gap-2">
              <Button onClick={retry} icon={<RotateCw className="size-3.5" />}>
                重试
              </Button>
              <Button variant="ghost" onClick={() => navigate("/new")}>
                直接发起讨论
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto flex h-full w-full max-w-[1180px] flex-col px-4 md:px-8">
        <EmptyState
          testId="home-empty"
          title="还没开场。"
          description="输入一个议题，召集你的第一组专家，几分钟内看一场有碰撞的圆桌。"
          action={
            <div className="flex flex-col items-center gap-3">
              <Button
                variant="primary"
                icon={<Plus className="size-4" aria-hidden />}
                onClick={() => navigate("/new")}
                data-testid="new-discussion"
              >
                发起第一场讨论
              </Button>
              <div className="flex flex-wrap justify-center gap-2">
                {SAMPLE_TOPICS.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => navigate(`/new?topic=${encodeURIComponent(topic)}`)}
                    className="rounded-full border border-line-1 px-3 py-1 text-[11px] text-ink-3 transition-colors hover:border-line-2 hover:text-ink-1"
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-6 pb-16 md:px-8">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-1">
            圆桌现场
          </h1>
          <p className="mt-1 text-[12px] text-ink-4">
            {active.length > 0
              ? `${active.length} 场进行中 · 数据每 5 秒刷新`
              : "暂时没有进行中的讨论"}
          </p>
        </div>
        <Button
          className="ml-auto"
          variant="primary"
          icon={<Plus className="size-4" aria-hidden />}
          onClick={() => navigate("/new")}
          data-testid="new-discussion"
        >
          发起新讨论
        </Button>
      </div>

      {status === "error" && (
        <p className="mt-4 rounded-md border border-danger/35 bg-danger/10 px-3 py-2 text-[11px] text-danger">
          刷新失败：{error}（正在显示缓存内容）
        </p>
      )}

      {active.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-[11px] font-semibold tracking-[0.16em] text-ink-4">
            进行中
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {active.map((item) => (
              <DiscussionCard key={item.id} item={item} now={now} />
            ))}
          </div>
        </section>
      )}

      {ended.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[11px] font-semibold tracking-[0.16em] text-ink-4">
            最近结束
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {ended.map((item) => (
              <DiscussionCard key={item.id} item={item} now={now} />
            ))}
          </div>
        </section>
      )}

      {failed.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[11px] font-semibold tracking-[0.16em] text-ink-4">
            生成失败
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {failed.map((item) => (
              <DiscussionCard key={item.id} item={item} now={now} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
