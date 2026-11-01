import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Sparkles } from "lucide-react";

import { friendlyMessage } from "../../api/client";
import { regenerateRoster } from "../../api/discussions";
import { ExpertCard, polarityLabel, PolarityScale } from "../../components/ExpertCard";
import { Button } from "../../components/ui/Button";
import { StatusPill } from "../../components/ui/Pill";
import { ErrorState, InlineError, Skeleton } from "../../components/ui/States";
import { expertsOf, hostOf } from "../../domain/selectors";
import type { SessionView } from "../../domain/session";
import { safeColor, tint } from "../../lib/color";
import { useSession } from "./SessionProvider";

function LobbySkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 py-8 md:px-8">
      <Skeleton className="h-6 w-24" />
      <Skeleton className="mt-3 h-7 w-3/4 max-w-lg" />
      <div className="mt-8 flex justify-center">
        <Skeleton className="h-28 w-full max-w-md" />
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: count }, (_, i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    </div>
  );
}

function HostSpotlight({ view }: { view: SessionView }) {
  const host = hostOf(view.roster);
  if (!host) return null;
  const color = safeColor(host.color);

  return (
    <div className="flex flex-col items-center">
      <p className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-ink-4">
        主持人
      </p>
      <div
        className="w-full max-w-md rounded-xl border px-5 py-4 text-center"
        style={{
          borderColor: color,
          background: tint(color, 8),
          boxShadow: `0 0 40px ${tint(color, 14)}`,
        }}
      >
        <div className="flex items-center justify-center gap-2">
          <span
            className="flex size-9 items-center justify-center rounded-full text-sm font-semibold"
            style={{ background: tint(color, 26), color: "#edf1f7" }}
          >
            {host.name.slice(0, 1)}
          </span>
          <div className="text-left">
            <p className="text-[15px] font-semibold text-ink-1">{host.name}</p>
            <p className="text-[11px] text-ink-3">
              {host.profession} · {host.title}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[12.5px] leading-5 text-ink-2">{host.stance}</p>
        <p className="mt-2 text-[11px] text-ink-4">关注：{host.focusArea}</p>
      </div>
    </div>
  );
}

function ExpertSpotlight({
  expert,
  seat,
}: {
  expert: ReturnType<typeof expertsOf>[number];
  seat: number;
}) {
  const color = safeColor(expert.color);
  return (
    <article
      data-testid={`roster-expert-${expert.id}`}
      className="relative overflow-hidden rounded-lg border border-line-1 bg-stage-900/60 p-4"
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: color }}
      />
      <div className="flex items-center gap-2">
        <span
          className="flex size-8 items-center justify-center rounded-full text-[12px] font-semibold"
          style={{ background: tint(color, 24), color: "#edf1f7" }}
        >
          {expert.name.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-ink-1">
            {expert.name}
            <span className="ml-1.5 text-[10px] font-normal text-ink-4 tabular-nums">
              0{seat}
            </span>
          </p>
          <p className="truncate text-[11px] text-ink-3">
            {expert.profession} · {expert.title}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[12.5px] leading-5 text-ink-2">{expert.stance}</p>

      <div className="mt-3 border-t border-line-1 pt-2.5">
        <p className="truncate text-[10px] text-ink-4" title={expert.stanceAxis}>
          立场轴：{expert.stanceAxis}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <PolarityScale polarity={expert.polarity} color={color} />
          <span className="text-[10px] text-ink-3">{polarityLabel(expert.polarity)}</span>
          <span className="ml-auto truncate text-[10px] text-ink-4">
            关注：{expert.focusArea}
          </span>
        </div>
      </div>
    </article>
  );
}

export function LobbyView() {
  const { view, dispatch, loadState, loadError, notFound, confirm } = useSession();
  const [action, setAction] = useState<"idle" | "confirming" | "regenerating">("idle");
  const [error, setError] = useState<string | null>(null);

  const host = hostOf(view.roster);
  const experts = expertsOf(view.roster);

  const onConfirm = async () => {
    if (action !== "idle") return;
    setAction("confirming");
    setError(null);
    try {
      await confirm();
    } catch (cause) {
      setError(friendlyMessage(cause));
      setAction("idle");
    }
  };

  const regenerate = async () => {
    if (action !== "idle") return;
    setAction("regenerating");
    setError(null);
    try {
      const result = await regenerateRoster(view.discussionId);
      dispatch({
        type: "hydrate",
        detail: {
          discussion: result.discussion,
          experts: result.experts,
          messages: [],
          insights: [],
          summary: null,
          activeTurn: null,
        },
      });
    } catch (cause) {
      setError(friendlyMessage(cause));
    } finally {
      setAction("idle");
    }
  };

  if (notFound) {
    return (
      <ErrorState
        title="这场讨论不存在"
        message={loadError ?? "它可能已经被删除了。"}
        action={
          <Link to="/">
            <Button>返回首页</Button>
          </Link>
        }
      />
    );
  }

  if (loadState === "loading" && view.roster.length === 0) {
    return <LobbySkeleton />;
  }

  if (loadState === "error") {
    return (
      <ErrorState
        title="加载失败"
        message={loadError ?? "无法读取这场讨论。"}
        action={
          <Link to="/">
            <Button>返回首页</Button>
          </Link>
        }
      />
    );
  }

  const generating = view.status === "generating";
  const failed = view.status === "failed";

  return (
    <div className="mx-auto flex h-full w-full max-w-[1080px] flex-col px-4 py-6 md:px-8">
      <div className="flex items-center gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-[11px] text-ink-3 transition-colors hover:text-ink-1"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          返回首页
        </Link>
        <span className="ml-auto">
          {failed ? (
            <StatusPill tone="failed" label="生成失败" />
          ) : generating ? (
            <StatusPill tone="generating" label="召集嘉宾中" pulse />
          ) : (
            <StatusPill tone="ready" label="阵容待确认" />
          )}
        </span>
      </div>

      <h1 className="mt-4 text-xl leading-8 font-semibold text-ink-1 md:text-2xl">
        {view.topic || "未命名议题"}
      </h1>
      <p className="mt-1 text-[12px] text-ink-4">
        确认后进入演播厅；讨论开始后阵容不能再改。
      </p>

      <div className="mt-6 flex-1">
        {host ? (
          <HostSpotlight view={view} />
        ) : (
          <div className="flex justify-center">
            <Skeleton className="h-28 w-full max-w-md" />
          </div>
        )}

        {experts.length > 0 && (
          <>
            <p className="mt-8 mb-3 text-[10px] font-semibold tracking-[0.18em] text-ink-4">
              专家席位 {experts.length}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {experts.map((expert, index) => (
                <ExpertSpotlight key={expert.id} expert={expert} seat={index + 1} />
              ))}
            </div>
          </>
        )}

        {experts.length > 0 && (
          <div className="mt-6 hidden xl:block">
            <p className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-ink-4">
              席位卡预览
            </p>
            <div className="grid grid-cols-5 gap-2">
              {view.roster.map((expert) => (
                <ExpertCard
                  key={expert.id}
                  expert={expert}
                  seat={expert.sortOrder}
                  status="idle"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4">
          <InlineError message={error} />
        </div>
      )}

      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 border-t border-line-1 bg-stage-1000/90 py-3 backdrop-blur">
        <Button
          variant="ghost"
          onClick={() => void regenerate()}
          loading={action === "regenerating"}
          disabled={action !== "idle" || generating}
          icon={<RefreshCw className="size-3.5" aria-hidden />}
          data-testid="regenerate-roster"
        >
          重新生成
        </Button>

        <span className="text-[11px] text-ink-4">
          {generating ? "正在生成阵容…" : `${view.expertCount || experts.length} 位专家 + 1 位主持人`}
        </span>

        <Button
          className="ml-auto"
          variant="primary"
          onClick={() => void onConfirm()}
          loading={action === "confirming"}
          disabled={action !== "idle" || !host || experts.length === 0 || generating}
          data-testid="confirm-roster"
          icon={<Sparkles className="size-4" aria-hidden />}
        >
          {failed ? "用这套阵容开播" : "确认阵容，开播"}
        </Button>
      </div>
    </div>
  );
}
