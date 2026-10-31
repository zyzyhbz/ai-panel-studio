import { APP_NAME } from "@ai-panel/shared";

export default function App() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--color-stage)] px-6 text-[var(--color-ink)]">
      <section className="w-full max-w-xl text-center">
        <p className="mb-3 text-xs tracking-[0.35em] text-[var(--color-muted)] uppercase">
          Live AI Roundtable
        </p>
        <h1 className="text-5xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="mt-5 text-base leading-7 text-[var(--color-muted)]">
          一场由 AI 驱动、实时推进的圆桌讨论。G2 脚手架已就绪，演播厅即将开始。
        </p>
      </section>
    </main>
  );
}
