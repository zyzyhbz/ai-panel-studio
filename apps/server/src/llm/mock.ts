import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Intent, Polarity } from "@ai-panel/shared";
import { HOST_COLOR, HOST_NAMES, INTENT_POOL, PROFESSION_POOL, SHA_SAFE_COLORS } from "./fixtures";
import type {
  LLMClient,
  LlmJsonRequest,
  LlmJsonResult,
  LlmMockMeta,
  LlmStreamRequest,
  LlmStreamResult,
  MockScenario,
  PromptKind,
} from "./types";
import { LlmError } from "./types";

/* ------------------------------------------------------------------ helpers */

function hash32(input: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  const item = list[Math.floor(rng() * list.length) % list.length];
  if (item === undefined) throw new Error("empty pool");
  return item;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new LlmError("aborted", "aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new LlmError("aborted", "aborted"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/* -------------------------------------------------------------- roster mock */

interface MockRoster {
  host: {
    name: string;
    profession: string;
    title: string;
    stance: string;
    stanceAxis: string;
    polarity: Polarity;
    focusArea: string;
    color: string;
  };
  experts: {
    name: string;
    profession: string;
    title: string;
    stance: string;
    stanceAxis: string;
    polarity: Polarity;
    focusArea: string;
    color: string;
  }[];
}

const HOST_STANCES = [
  { stance: "中立，负责追问与串联", stanceAxis: "中立主持", focusArea: "节奏与追问" },
  { stance: "中立，只对论证质量负责", stanceAxis: "中立主持", focusArea: "论证质量" },
  { stance: "中立，负责把分歧讲清楚", stanceAxis: "中立主持", focusArea: "共识与分歧" },
];

export function buildMockRoster(discussionId: string, expertCount: number): MockRoster {
  const rng = mulberry32(hash32(`roster:${discussionId}`));
  const hostName = pick(rng, HOST_NAMES);
  const hostStance = pick(rng, HOST_STANCES);
  const order = [...PROFESSION_POOL];
  // Deterministic shuffle (Fisher–Yates with the seeded rng).
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = order[i]!;
    order[i] = order[j]!;
    order[j] = a;
  }
  const names = [...new Set(EXPERT_NAMES_SHUFFLED(rng))];
  const experts = order.slice(0, expertCount).map((p, index) => ({
    name: names[index] ?? `专家${index + 1}`,
    profession: p.profession,
    title: p.title,
    stance: p.stance,
    stanceAxis: p.stanceAxis,
    polarity: p.polarity,
    focusArea: p.focusArea,
    color: SHA_SAFE_COLORS[index % SHA_SAFE_COLORS.length]!,
  }));
  return {
    host: {
      name: hostName,
      profession: "科技主持人",
      title: "资深圆桌主持",
      stance: hostStance.stance,
      stanceAxis: hostStance.stanceAxis,
      polarity: "neutral",
      focusArea: hostStance.focusArea,
      color: HOST_COLOR,
    },
    experts,
  };
}

function EXPERT_NAMES_SHUFFLED(rng: () => number): string[] {
  const pool = [
    "周明",
    "许澜",
    "陈默",
    "陆嘉",
    "沈知远",
    "顾清",
    "唐棠",
    "罗一鸣",
    "叶秋",
    "苏牧",
  ];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = a;
  }
  return pool;
}

/* --------------------------------------------------------- speech templates */

const SPEECH: Record<string, (focus: string, topic: string) => string> = {
  opening: (focus, topic) =>
    `今天这场我们只谈${topic}，先请各位给出一个明确判断，先别急着求共识。${
      focus ? `我会盯着${focus}这条线追问。` : ""
    }`,
  probe: (focus) => `我想追一句：${focus || "这个判断"}到底靠什么成立？如果前提变了，结论还站得住吗？`,
  rebut: (focus) =>
    `我不太同意这个说法。${focus || "这个判断"}把结构问题当成了个人选择，这一点被低估了。`,
  support: (focus) => `我赞成刚才的判断，${focus || "这个角度"}确实是最关键的变量，但结论还要再往前一步。`,
  extend: (focus) => `顺着这个思路补一点：${focus || "成本结构"}一旦变化，受益者和受损者会立刻换位。`,
  clarify: (focus) => `先把概念分清楚，${focus || "这件事"}和数量是两回事，混在一起谈会得出相反的结论。`,
  mediate: (focus) => `两位其实说的是不同层面的事。先把${focus || "各自的层面"}分开，分歧可能就小一半。`,
  redirect: (_focus, topic) => `我们有点跑偏了，回到${topic}本身：真正的约束条件是什么？`,
  summary: () => `我先收一下：共识是方向已经清楚，分歧在于速度和代价，还没解决的是谁来承担过渡成本。`,
};

/* --------------------------------------------------------------- mock client */

export interface MockClientOptions {
  model?: string;
  delayMs?: number;
  qaLogPath?: string;
  /** Injected clock for deterministic tests. */
  now?: () => string;
}

export interface QaLogEntry {
  requestId: string;
  discussionId: string;
  kind: string;
  model: string;
  thinking: "disabled" | "enabled";
  includedMessageIds: string[];
  usage: { inputTokens: number; outputTokens: number };
  at: string;
}

export function createMockLlmClient(options: MockClientOptions = {}): LLMClient {
  const model = options.model ?? "mock-deepseek-flash";
  const delayMs = options.delayMs ?? 0;
  const now = options.now ?? (() => new Date().toISOString());
  const attempts = new Map<string, number>();
  let logDirReady = false;

  function attemptKey(kind: PromptKind, meta?: LlmMockMeta): string {
    return `${meta?.discussionId ?? "unknown"}:${kind}:${meta?.turnIndex ?? 0}`;
  }

  function bumpAttempt(kind: PromptKind, meta?: LlmMockMeta): number {
    const key = attemptKey(kind, meta);
    const next = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, next);
    return next;
  }

  function resolveScenario(meta?: LlmMockMeta): MockScenario {
    const base = meta?.scenario ?? "normal";
    if (base !== "mixed") return base;
    const cycle: MockScenario[] = ["normal", "normal", "invalid-json", "normal", "long"];
    const index = (meta?.turnIndex ?? 0) % cycle.length;
    return cycle[index] ?? "normal";
  }

  function qaLog(entry: QaLogEntry): void {
    if (!options.qaLogPath) return;
    try {
      if (!logDirReady) {
        mkdirSync(dirname(options.qaLogPath), { recursive: true });
        logDirReady = true;
      }
      appendFileSync(options.qaLogPath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      /* observability must never break the request */
    }
  }

  function buildJsonPayload(kind: PromptKind, meta?: LlmMockMeta): unknown {
    const rng = mulberry32(
      hash32(`${meta?.discussionId ?? "x"}:${kind}:${meta?.turnIndex ?? 0}`),
    );
    if (kind === "roster") {
      return buildMockRoster(meta?.discussionId ?? "x", meta?.expertCount ?? 4);
    }
    if (kind === "decision") {
      const candidates = meta?.candidates ?? [];
      const eligible = candidates.filter((c) => c.role !== "host");
      const pool = eligible.length > 0 ? eligible : candidates;
      const chosen = pool.length > 0 ? pick(rng, pool) : null;
      if (!chosen) {
        return { speakerId: "", intent: "extend", turnFocus: "补充" };
      }
      const intent = chosen.intent ?? pick(rng, INTENT_POOL);
      return {
        speakerId: chosen.id,
        intent,
        turnFocus: chosen.name ? `${chosen.name}关注的层面` : "补充视角",
      };
    }
    if (kind === "insight") {
      const ids = meta?.messageIds ?? [];
      const take = (n: number): string[] => ids.slice(0, Math.min(n, ids.length));
      const insights: unknown[] = [];
      if (ids.length >= 2) {
        insights.push({
          type: "consensus",
          content: "各方都认为结构会变化，只是对速度和代价判断不同",
          evidenceMessageIds: take(2),
        });
        insights.push({
          type: "divergence",
          content: "变化是升级还是压缩，双方没有达成一致",
          evidenceMessageIds: take(2),
        });
      }
      if (ids.length >= 1) {
        insights.push({
          type: "open_question",
          content: "过渡成本由谁承担，目前没有答案",
          evidenceMessageIds: take(1),
        });
      }
      return { insights };
    }
    return {};
  }

  return {
    mode: "mock",
    model,

    async json<T>(request: LlmJsonRequest<T>): Promise<LlmJsonResult<T>> {
      const meta = request.meta;
      const scenario = resolveScenario(meta);
      const attempt = bumpAttempt(request.prompt.kind, meta);

      if (scenario === "timeout") {
        // Never resolves on its own: the caller's timeout/abort must fire.
        await new Promise<void>((_resolve, reject) => {
          if (request.signal.aborted) {
            reject(new LlmError("aborted", "aborted"));
            return;
          }
          request.signal.addEventListener(
            "abort",
            () => reject(new LlmError("timeout", "mock timeout")),
            { once: true },
          );
        });
      }
      if (scenario === "slow") {
        await sleep(Math.max(400, delayMs * 4), request.signal);
      }
      await sleep(delayMs, request.signal);

      const shouldFail =
        attempt === 1 && (scenario === "invalid-json" || scenario === "empty");

      if (shouldFail && scenario === "invalid-json") {
        qaLog({
          requestId: `mock-${attemptKey(request.prompt.kind, meta)}`,
          discussionId: meta?.discussionId ?? "unknown",
          kind: request.prompt.kind,
          model,
          thinking: "disabled",
          includedMessageIds: meta?.messageIds ?? [],
          usage: { inputTokens: 0, outputTokens: 0 },
          at: now(),
        });
        throw new LlmError("invalid_output", "mock: model returned non-JSON");
      }
      if (shouldFail && scenario === "empty") {
        throw new LlmError("empty_output", "mock: model returned empty content");
      }

      const payload = buildJsonPayload(request.prompt.kind, meta);
      const raw = JSON.stringify(payload);
      qaLog({
        requestId: `mock-${attemptKey(request.prompt.kind, meta)}`,
        discussionId: meta?.discussionId ?? "unknown",
        kind: request.prompt.kind,
        model,
        thinking: "disabled",
        includedMessageIds: meta?.messageIds ?? [],
        usage: { inputTokens: raw.length, outputTokens: raw.length },
        at: now(),
      });
      const value = request.parse(raw);
      return { value, raw, repaired: attempt > 1 };
    },

    async *stream(
      request: LlmStreamRequest,
    ): AsyncGenerator<string, LlmStreamResult, void> {
      const meta = request.meta;
      const scenario = resolveScenario(meta);
      const rng = mulberry32(
        hash32(`${meta?.discussionId ?? "x"}:speech:${meta?.turnIndex ?? 0}`),
      );

      if (scenario === "timeout") {
        await new Promise<void>((_resolve, reject) => {
          if (request.signal.aborted) {
            reject(new LlmError("aborted", "aborted"));
            return;
          }
          request.signal.addEventListener(
            "abort",
            () => reject(new LlmError("timeout", "mock stream timeout")),
            { once: true },
          );
        });
      }

      if (scenario === "empty") {
        return { usage: { inputTokens: 0, outputTokens: 0 } };
      }

      const intent = (meta?.previousContent ? "extend" : "rebut") as Intent;
      const template = SPEECH[intent] ?? SPEECH.extend!;
      let text: string;
      if (scenario === "duplicate" && meta?.previousContent) {
        text = meta.previousContent;
      } else if (scenario === "long") {
        text = `${template("这个判断背后的假设", "议题").replace(/。$/, "")}，而且这一点在更长的时间尺度上会变得更明显，因为它不仅改变了个体的选择空间，也改变了组织评估人的方式，最后连培养路径都会跟着变。`;
      } else {
        const focus = request.prompt.user
          .split("\n")
          .find((line) => line.includes("本轮关注点"));
        const focusText = focus?.split("：").slice(-1)[0]?.split("，")[0] ?? "";
        text = template(focusText.trim(), "这个议题");
      }

      const chunks = splitIntoChunks(text, 8);
      let produced = "";
      for (const chunk of chunks) {
        if (request.signal.aborted) throw new LlmError("aborted", "aborted");
        await sleep(delayMs || 8, request.signal);
        produced += chunk;
        yield chunk;
      }

      qaLog({
        requestId: `mock-${attemptKey("speech", meta)}`,
        discussionId: meta?.discussionId ?? "unknown",
        kind: "speech",
        model,
        thinking: "disabled",
        includedMessageIds: meta?.messageIds ?? [],
        usage: { inputTokens: produced.length, outputTokens: produced.length },
        at: now(),
      });
      // `rng` touches keeps determinism explicit for future template variation.
      void rng;
      return { usage: { inputTokens: 0, outputTokens: produced.length } };
    },
  };
}

function splitIntoChunks(text: string, size: number): string[] {
  const chars = [...text];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) {
    out.push(chars.slice(i, i + size).join(""));
  }
  return out;
}
