import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, Sparkles } from "lucide-react";

import { ApiError, friendlyMessage } from "../../api/client";
import { createDiscussion } from "../../api/discussions";
import { Button } from "../../components/ui/Button";
import { InlineError } from "../../components/ui/States";
import { cn } from "../../lib/cn";
import { uuid } from "../../lib/uuid";

const MIN_TOPIC = 2;
const MAX_TOPIC = 200;
const MIN_EXPERTS = 3;
const MAX_EXPERTS = 6;
const DEFAULT_EXPERTS = 4;
const SLOW_HINT_MS = 12_000;

function codepointLength(value: string): number {
  return Array.from(value).length;
}

type Phase = "idle" | "submitting" | "error";

export function CreatePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [topic, setTopic] = useState(() => params.get("topic") ?? "");
  const [expertCount, setExpertCount] = useState(DEFAULT_EXPERTS);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [failedDiscussionId, setFailedDiscussionId] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  /**
   * One id per logical submission. Retrying after a timeout MUST reuse it,
   * otherwise the server creates a second discussion for the same intent.
   */
  const requestIdRef = useRef<string>(uuid());
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);

  const length = codepointLength(topic.trim());
  const trimmed = topic.trim();
  const tooShort = length > 0 && length < MIN_TOPIC;
  const tooLong = codepointLength(topic) > MAX_TOPIC;
  const valid = length >= MIN_TOPIC && !tooLong;

  const counterTone = tooLong
    ? "text-danger"
    : length >= MIN_TOPIC
      ? "text-ink-4"
      : "text-ink-4";

  useEffect(() => {
    if (submittedAt === null) return;
    const timer = window.setInterval(() => {
      const ms = Date.now() - submittedAt;
      setElapsed(ms);
      if (ms > SLOW_HINT_MS) setSlow(true);
    }, 200);
    return () => window.clearInterval(timer);
  }, [submittedAt]);

  const submit = async () => {
    if (!valid || phase === "submitting") return;
    setPhase("submitting");
    setError(null);
    setFailedDiscussionId(null);
    setSubmittedAt(Date.now());
    setSlow(false);

    try {
      const result = await createDiscussion({
        topic: trimmed,
        expertCount,
        clientRequestId: requestIdRef.current,
      });
      navigate(`/d/${result.discussion.id}`, { replace: true });
    } catch (cause) {
      setSubmittedAt(null);
      setPhase("error");
      setError(friendlyMessage(cause));
      if (cause instanceof ApiError) setFailedDiscussionId(cause.discussionId);
    }
  };

  const seats = useMemo(() => Array.from({ length: expertCount }, (_, i) => i), [expertCount]);

  if (phase === "submitting") {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-center px-4 py-10 md:px-8">
        <div className="rounded-xl border border-line-1 bg-stage-900/50 p-6">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-live uppercase">
            Casting
          </p>
          <h1 className="mt-2 text-lg font-semibold text-ink-1">正在召集嘉宾</h1>
          <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-ink-3">
            {trimmed}
          </p>

          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {seats.map((seat) => (
              <div
                key={seat}
                className="flex items-center gap-2 rounded-lg border border-line-1 bg-stage-950/60 px-3 py-2.5"
              >
                <span className="size-6 animate-pulse rounded-full bg-stage-800" />
                <span className="flex-1 space-y-1.5">
                  <span className="block h-2 w-16 animate-pulse rounded bg-stage-800" />
                  <span className="block h-2 w-10 animate-pulse rounded bg-stage-850" />
                </span>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-2 text-[11px] text-ink-4">
            <span className="size-3 animate-spin rounded-full border-[1.5px] border-ink-4 border-t-transparent" />
            <span className="tabular-nums">{(elapsed / 1000).toFixed(1)}s</span>
            <span>通常 5–10 秒</span>
          </div>

          {slow && (
            <div className="mt-4 rounded-md border border-live/30 bg-live/10 px-3 py-2 text-[11px] leading-5 text-live">
              比平时慢了一些。你可以继续等待，或者
              <Link to="/" className="mx-1 underline underline-offset-2">
                去首页看看
              </Link>
              —— 讨论可能已经创建好了。
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-center px-4 py-8 md:px-8 md:py-12">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-[11px] text-ink-3 transition-colors hover:text-ink-1"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        返回首页
      </Link>

      <div className="rounded-xl border border-line-1 bg-stage-900/50 p-5 md:p-7">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-live uppercase">
          New roundtable
        </p>
        <h1 className="mt-2 text-xl font-semibold text-ink-1 md:text-2xl">
          这场圆桌，聊点什么？
        </h1>
        <p className="mt-1.5 text-[12px] leading-5 text-ink-3">
          我们会生成一位主持人和几位立场互补的专家，然后由他们自己决定谁先说。
        </p>

        <form
          className="mt-6 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <label
                htmlFor="topic"
                className="text-[11px] font-semibold tracking-[0.1em] text-ink-3"
              >
                议题
              </label>
              <span className={cn("text-[11px] tabular-nums", counterTone)} data-testid="topic-counter">
                {length} / {MAX_TOPIC}
              </span>
            </div>
            <textarea
              id="topic"
              name="topic"
              data-testid="topic-input"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              rows={3}
              maxLength={MAX_TOPIC + 40}
              placeholder="例如：AI 会不会让初级开发者失业？"
              className={cn(
                "w-full resize-none rounded-lg border bg-stage-950/70 px-3 py-2.5 text-[14px] leading-6 text-ink-1",
                "placeholder:text-ink-4 focus:outline-none",
                tooLong ? "border-danger/50" : "border-line-1 focus:border-line-2",
              )}
              aria-describedby="topic-hint"
              aria-invalid={tooLong || tooShort}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <p id="topic-hint" className="mt-1.5 text-[11px] text-ink-4">
              {tooLong
                ? `超出 ${MAX_TOPIC} 个字符，请删减。`
                : tooShort
                  ? `至少 ${MIN_TOPIC} 个字符。`
                  : `2–200 个字符，按纯文本接受。⌘/Ctrl + Enter 提交。`}
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold tracking-[0.1em] text-ink-3">
                专家人数
              </span>
              <span className="text-[11px] text-ink-4 tabular-nums">
                另加 1 位主持人
              </span>
            </div>
            <div
              role="group"
              aria-label="专家人数"
              className="inline-flex items-center gap-1 rounded-lg border border-line-1 p-1"
            >
              {[3, 4, 5, 6].map((count) => (
                <button
                  key={count}
                  type="button"
                  data-testid={`expert-count-${count}`}
                  aria-pressed={expertCount === count}
                  onClick={() => setExpertCount(count)}
                  className={cn(
                    "h-8 w-10 rounded-md text-[13px] tabular-nums transition-colors",
                    expertCount === count
                      ? "bg-live font-semibold text-stage-1000"
                      : "text-ink-3 hover:bg-stage-850 hover:text-ink-1",
                  )}
                >
                  {count}
                </button>
              ))}
            </div>
            <span className="ml-3 text-[11px] text-ink-4">
              共 {expertCount + 1} 位参与者
            </span>
          </div>

          {phase === "error" && error && (
            <div className="space-y-2">
              <InlineError message={error} />
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-4">
                <AlertCircle className="size-3.5" aria-hidden />
                重试会复用同一个请求标识，不会重复创建讨论。
                {failedDiscussionId && (
                  <Link
                    to={`/d/${failedDiscussionId}`}
                    className="text-live underline underline-offset-2"
                  >
                    查看那次生成
                  </Link>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!valid}
              data-testid="submit-create"
              icon={<Sparkles className="size-4" aria-hidden />}
            >
              生成阵容
            </Button>
            <span className="text-[11px] text-ink-4">
              {valid ? "预计 5–10 秒" : `还需要 ${Math.max(0, MIN_TOPIC - length)} 个字符`}
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
