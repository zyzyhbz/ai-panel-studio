/**
 * DEV-ONLY mock backend.
 *
 * Enabled exclusively with `VITE_MOCK_API=1` in development so the studio can
 * be walked end-to-end (home → create → lobby → live → replay) before the
 * real Fastify routes land. It is never imported in a production build: the
 * `import.meta.env.DEV` guard is statically false there, so Rollup drops the
 * dynamic import entirely.
 *
 * Nothing in the app depends on this file — the API client always talks to
 * `/api/*`; this only intercepts `fetch` and `EventSource` in the browser.
 */
import type { DiscussionStatus, Intent } from "@ai-panel/shared";

import type {
  Discussion,
  DiscussionDetail,
  DiscussionListItem,
  Expert,
  Insight,
  Message,
  PersistedEvent,
  Summary,
} from "../api/types";

const HOST: Expert = {
  id: "e_host",
  role: "host",
  name: "林致远",
  profession: "科技主持人",
  title: "资深圆桌主持",
  stance: "中立，只负责追问、串联和收尾",
  stanceAxis: "岗位替代 vs 岗位重构",
  polarity: "neutral",
  color: "#D9D9D9",
  focusArea: "开场与节奏",
  sortOrder: 0,
};

const PERSONAS: Array<Omit<Expert, "sortOrder" | "role">> = [
  {
    id: "e_01",
    name: "周明",
    profession: "软件工程师",
    title: "技术负责人",
    stance: "AI 会重构初级岗位，而不是简单消灭",
    stanceAxis: "岗位替代 vs 岗位重构",
    polarity: "support",
    color: "#6C8FD6",
    focusArea: "工程实践与岗位结构",
  },
  {
    id: "e_02",
    name: "许澜",
    profession: "组织心理学研究者",
    title: "副教授",
    stance: "AI 先替代任务，再压缩岗位，代价落在新人身上",
    stanceAxis: "岗位替代 vs 岗位重构",
    polarity: "strong_oppose",
    color: "#C77DB0",
    focusArea: "组织行为与新人成长",
  },
  {
    id: "e_03",
    name: "陈默",
    profession: "劳动经济学研究者",
    title: "研究员",
    stance: "取决于企业愿不愿意为再培训买单",
    stanceAxis: "企业买单 vs 个人自担",
    polarity: "oppose",
    color: "#5FA8C9",
    focusArea: "再培训成本与用工结构",
  },
  {
    id: "e_04",
    name: "赵一",
    profession: "早期投资人",
    title: "合伙人",
    stance: "资本会加速替代，但会创造新的岗位形态",
    stanceAxis: "效率优先 vs 就业优先",
    polarity: "strong_support",
    color: "#9AA55B",
    focusArea: "资本周期与创业机会",
  },
  {
    id: "e_05",
    name: "苏禾",
    profession: "教育产品设计者",
    title: "课程负责人",
    stance: "教育体系跟不上岗位变化的速度",
    stanceAxis: "教育先行 vs 岗位先行",
    polarity: "oppose",
    color: "#8E86C9",
    focusArea: "人才培养与课程设计",
  },
  {
    id: "e_06",
    name: "何川",
    profession: "企业 CTO",
    title: "技术副总裁",
    stance: "招聘口径已经变了，但没人在意",
    stanceAxis: "岗位替代 vs 岗位重构",
    polarity: "support",
    color: "#B08A6A",
    focusArea: "招聘实践与团队编制",
  },
];

interface Session {
  id: string;
  topic: string;
  status: DiscussionStatus;
  expertCount: number;
  turnCount: number;
  plannedTurns: number;
  maxTurns: number;
  seq: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  errorCode: string | null;
  clientRequestId?: string;
  experts: Expert[];
  messages: Message[];
  insights: Insight[];
  summary: Summary | null;
  activeTurn: DiscussionDetail["activeTurn"];
  events: PersistedEvent[];
  listeners: Set<(frame: Frame) => void>;
}

interface Frame {
  type: string;
  id?: number;
  data: unknown;
}

const sessions = new Map<string, Session>();
const byRequestId = new Map<string, string>();

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(counter += 1).toString(36)}`;

function planTurns(expertCount: number): number {
  return Math.min(12, Math.max(8, 4 + 2 * expertCount));
}

function buildRoster(expertCount: number): Expert[] {
  return [
    HOST,
    ...PERSONAS.slice(0, expertCount).map((persona, index) => ({
      ...persona,
      role: "expert" as const,
      sortOrder: index + 1,
    })),
  ];
}

function toDiscussion(session: Session): Discussion {
  return {
    id: session.id,
    topic: session.topic,
    status: session.status,
    expertCount: session.expertCount,
    turnCount: session.turnCount,
    lastSeq: session.seq,
    plannedTurns: session.plannedTurns,
    maxTurns: session.maxTurns,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    errorCode: session.errorCode,
  };
}

function toListItem(session: Session): DiscussionListItem {
  const host = session.experts.find((e) => e.role === "host");
  return {
    ...toDiscussion(session),
    hostName: host?.name ?? null,
    experts: session.experts,
    summaryPreview: session.summary
      ? Array.from(session.summary.content).slice(0, 80).join("")
      : null,
    errorCode: session.errorCode,
  };
}

function toDetail(session: Session): DiscussionDetail {
  return {
    discussion: toDiscussion(session),
    experts: session.experts,
    messages: session.messages,
    insights: session.insights,
    summary: session.summary,
    activeTurn: session.activeTurn,
  };
}

function createSession(topic: string, expertCount: number, requestId: string): Session {
  const id = `d_${(counter += 1).toString(36)}`;
  const planned = planTurns(expertCount);
  const session: Session = {
    id,
    topic,
    status: "ready",
    expertCount,
    turnCount: 0,
    plannedTurns: planned,
    maxTurns: Math.min(14, planned + 2),
    seq: 0,
    createdAt: now(),
    updatedAt: now(),
    startedAt: null,
    endedAt: null,
    errorCode: null,
    clientRequestId: requestId,
    experts: buildRoster(expertCount),
    messages: [],
    insights: [],
    summary: null,
    activeTurn: null,
    events: [],
    listeners: new Set(),
  };
  sessions.set(id, session);
  byRequestId.set(requestId, id);
  push(session, "roster.ready", { discussionId: id, experts: session.experts });
  return session;
}

function push(session: Session, type: string, payload: Record<string, unknown>): void {
  session.seq += 1;
  session.updatedAt = now();
  const event = {
    seq: session.seq,
    type,
    payload,
    createdAt: session.updatedAt,
  } as unknown as PersistedEvent;
  session.events.push(event);
  broadcast(session, { type, id: session.seq, data: payload });
}

function emitLive(session: Session, type: string, payload: Record<string, unknown>): void {
  broadcast(session, { type, data: payload });
}

function broadcast(session: Session, frame: Frame): void {
  for (const listener of session.listeners) listener(frame);
}

/* ------------------------------------------------------------------ *
 * Scripted discussion
 * ------------------------------------------------------------------ */

const SCRIPT: Array<{ seat: number; intent: Intent; focus: string; text: string }> = [
  {
    seat: 1,
    intent: "opening",
    focus: "把议题拆成两个可争论的问题",
    text: "今天我们不急着下结论。先请各位判断：AI 到底在替代初级岗位，还是在改写初级岗位的职责？",
  },
  {
    seat: 2,
    intent: "rebut",
    focus: "反驳“替代论”忽略了任务粒度",
    text: "我不同意“替代”。AI 先吃掉的是一组任务，不是一个岗位；真正变化的是初级岗位里那些可被描述的部分。",
  },
  {
    seat: 3,
    intent: "extend",
    focus: "补充再培训成本这个变量",
    text: "再补一个变量：企业愿不愿意为再培训买单，决定了岗位是升级还是被压缩到消失。",
  },
  {
    seat: 1,
    intent: "probe",
    focus: "追问谁承担成本",
    text: "那如果企业不买单呢？这个成本最后落在刚入行的人身上，还是落在公共教育上？",
  },
  {
    seat: 4,
    intent: "support",
    focus: "从资本周期看岗位形态",
    text: "资本一定会加速替代，但同时会造出新的岗位形态——只是新岗位不一定留给应届生。",
  },
  {
    seat: 2,
    intent: "clarify",
    focus: "澄清“重构”不等于“变好”",
    text: "“重构”听起来中性，但对个体来说可能是降级：同样叫工程师，做的事情和议价能力完全不同。",
  },
  {
    seat: 5,
    intent: "extend",
    focus: "教育与岗位变化的速度差",
    text: "教育体系的更新周期是四到五年，岗位形态的变化是十八个月，这个速度差本身就是问题。",
  },
  {
    seat: 3,
    intent: "rebut",
    focus: "反对把问题全部推给教育",
    text: "我不太赞成把责任推给教育。企业内部的岗位设计和晋升通道，本来就可以吸收这个变化。",
  },
  {
    seat: 1,
    intent: "mediate",
    focus: "串联两位专家的分歧点",
    text: "我听到两条线：一条说岗位会升级，一条说议价能力会下降。这两件事可以同时成立吗？",
  },
  {
    seat: 2,
    intent: "extend",
    focus: "给出可验证的判断标准",
    text: "可以。判断标准是：三年后同一个岗位的入门门槛是变高还是变低。门槛变高就是升级，变低就是压缩。",
  },
];

function chunk(text: string): string[] {
  const chars = Array.from(text);
  const size = 4;
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) {
    out.push(chars.slice(i, i + size).join(""));
  }
  return out;
}

function buildInsights(session: Session, turn: number): Insight[] {
  const out: Insight[] = [];
  if (turn >= 2) {
    out.push({
      id: "i_consensus",
      type: "consensus",
      content: "双方都认为初级岗位的职责会变化，而不是原样保留",
      evidenceMessageIds: session.messages.slice(0, 2).map((m) => m.id),
      firstSeenTurn: 2,
      updatedAt: session.updatedAt,
    });
  }
  if (turn >= 3) {
    out.push({
      id: "i_divergence",
      type: "divergence",
      content: "变化是“升级”还是“压缩”，双方给出的是相反的判断",
      evidenceMessageIds: session.messages.slice(1, 3).map((m) => m.id),
      firstSeenTurn: 3,
      updatedAt: session.updatedAt,
    });
  }
  if (turn >= 5) {
    out.push({
      id: "i_open",
      type: "open_question",
      content: "企业是否愿意为初级岗位的再培训买单？",
      evidenceMessageIds: session.messages.slice(2, 4).map((m) => m.id),
      firstSeenTurn: 5,
      updatedAt: session.updatedAt,
    });
  }
  return out;
}

async function runSession(session: Session): Promise<void> {
  await sleep(260);
  if (session.status !== "live") return;

  session.startedAt = now();
  push(session, "discussion.started", {
    discussionId: session.id,
    startedAt: session.startedAt,
  });

  const turns = Math.min(
    SCRIPT.length,
    Math.max(6, session.plannedTurns - 2),
  );

  for (let i = 0; i < turns; i += 1) {
    if (session.status !== "live") return;
    const step = SCRIPT[i];
    const speaker = session.experts[step.seat] ?? session.experts[1];
    const turnIndex = session.turnCount + 1;
    const messageId = nextId("m");

    session.activeTurn = {
      turnIndex,
      speakerId: speaker.id,
      messageId,
      intent: step.intent,
      turnFocus: step.focus,
    };
    push(session, "turn.started", {
      discussionId: session.id,
      turnIndex,
      speakerId: speaker.id,
      messageId,
      intent: step.intent,
      turnFocus: step.focus,
    });

    await sleep(420);
    for (const piece of chunk(step.text)) {
      if (session.status !== "live") return;
      emitLive(session, "message.delta", {
        discussionId: session.id,
        messageId,
        speakerId: speaker.id,
        turnIndex,
        delta: piece,
      });
      await sleep(48);
    }

    const message: Message = {
      id: messageId,
      expertId: speaker.id,
      speakerName: speaker.name,
      speakerTitle: speaker.title,
      speakerColor: speaker.color,
      content: step.text,
      intent: step.intent,
      turnIndex,
      charCount: Array.from(step.text).length,
      degraded: false,
      createdAt: now(),
    };
    session.messages.push(message);
    session.turnCount = turnIndex;
    session.activeTurn = null;
    push(session, "message.completed", {
      discussionId: session.id,
      message,
    });

    if (turnIndex % 2 === 1) {
      session.insights = buildInsights(session, turnIndex);
      push(session, "insight.updated", {
        discussionId: session.id,
        insights: session.insights,
      });
    }

    await sleep(360);
  }

  if (session.status !== "live") return;
  await finish(session, "auto");
}

async function finish(session: Session, reason: "user" | "auto"): Promise<void> {
  session.status = "summarizing";
  session.activeTurn = null;
  push(session, "discussion.summarizing", {
    discussionId: session.id,
    reason,
    startedAt: now(),
  });

  await sleep(700);
  const summary: Summary = {
    content:
      "这场讨论的共识是：AI 首先改变的是任务结构，而不是一次性消灭某个岗位；双方都同意初级岗位的职责会发生实质性变化。" +
      "主要分歧在于这个变化的方向——一方认为门槛会变高、岗位因此升级，另一方认为议价能力会下降、岗位实际上被压缩。" +
      "尚未解决的问题是：再培训的成本由谁承担，以及企业是否有动力为此买单。",
    createdAt: now(),
    isFallback: false,
  };
  session.summary = summary;
  push(session, "summary.completed", { discussionId: session.id, summary });
  session.status = "ended";
  session.endedAt = now();
  push(session, "discussion.ended", {
    discussionId: session.id,
    endedAt: session.endedAt,
  });
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": nextId("req") },
  });
}

function error(code: string, message: string, status: number, details?: unknown): Response {
  return json({ error: { code, message, details } }, status);
}

function table() {
  return [...sessions.values()].sort((a, b) => {
    const rank = (s: Session) => (s.status === "ended" || s.status === "failed" ? 1 : 0);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/api/")) return null;

  const parsed = new URL(url, window.location.origin);
  const path = parsed.pathname.replace(/^\/api/, "");
  const method = (init?.method ?? "GET").toUpperCase();

  if (path === "/health") {
    return json({ status: "ok", version: "0.1.0-mock", llmMode: "mock", dbReady: true });
  }

  if (path === "/discussions" && method === "GET") {
    const status = parsed.searchParams.get("status") ?? "all";
    let items = table();
    if (status === "active") {
      items = items.filter((s) => !["ended", "failed"].includes(s.status));
    } else if (status === "ended") {
      items = items.filter((s) => s.status === "ended");
    } else if (status === "failed") {
      items = items.filter((s) => s.status === "failed");
    } else if (status !== "all") {
      items = items.filter((s) => s.status === status);
    }
    return json({ items: items.map(toListItem), total: items.length });
  }

  if (path === "/discussions" && method === "POST") {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      topic?: string;
      expertCount?: number;
      clientRequestId?: string;
    };
    const topic = (body.topic ?? "").trim();
    const count = Math.min(6, Math.max(3, body.expertCount ?? 4));
    const requestId = body.clientRequestId ?? nextId("req");

    const existing = byRequestId.get(requestId);
    if (existing) {
      const session = sessions.get(existing);
      if (session) {
        return json({ discussion: toDiscussion(session), experts: session.experts }, 200);
      }
    }

    if (Array.from(topic).length < 2) {
      return error("VALIDATION_ERROR", "议题至少 2 个字符", 400);
    }

    await sleep(1400); // keep the "casting" skeleton visible for a beat
    const session = createSession(topic, count, requestId);
    return json({ discussion: toDiscussion(session), experts: session.experts }, 201);
  }

  const match = /^\/discussions\/([^/]+)(\/.*)?$/.exec(path);
  if (match) {
    const session = sessions.get(decodeURIComponent(match[1]));
    const rest = match[2] ?? "";
    if (!session) return error("NOT_FOUND", "讨论不存在", 404);

    if (rest === "" && method === "GET") return json(toDetail(session));

    if (rest === "/state" && method === "GET") {
      return json({
        discussionId: session.id,
        status: session.status,
        turnCount: session.turnCount,
        lastSeq: session.seq,
        experts: session.experts,
        messages: session.messages,
        insights: session.insights,
        summary: session.summary,
        activeTurn: session.activeTurn,
      });
    }

    if (rest === "/confirm" && method === "POST") {
      if (session.status === "ready") {
        session.status = "live";
        session.startedAt = now();
        void runSession(session);
      }
      return json({ discussion: toDiscussion(session) }, 202);
    }

    if (rest === "/end" && method === "POST") {
      if (session.status === "live") {
        session.status = "summarizing";
        void finish(session, "user");
      }
      return json({ discussion: toDiscussion(session) }, 202);
    }

    if (rest === "/roster/regenerate" && method === "POST") {
      session.experts = buildRoster(session.expertCount);
      push(session, "roster.ready", {
        discussionId: session.id,
        experts: session.experts,
      });
      return json({ discussion: toDiscussion(session), experts: session.experts });
    }

    if (rest === "/events" && method === "GET") {
      const after = Number(parsed.searchParams.get("after") ?? 0);
      const limit = Number(parsed.searchParams.get("limit") ?? 500);
      const items = session.events.filter((e) => e.seq > after).slice(0, limit);
      return json({
        items,
        lastSeq: session.seq,
        hasMore: items.length === limit && session.seq > (items.at(-1)?.seq ?? after),
      });
    }

    if (rest === "/stream" && method === "GET") {
      return error("INVALID_STATE", "mock 模式下 SSE 由 MockEventSource 处理", 400);
    }
  }

  return error("NOT_FOUND", "mock 未实现该接口", 404);
}

/* ------------------------------------------------------------------ *
 * EventSource
 * ------------------------------------------------------------------ */

type Listener = (event: MessageEvent<string>) => void;

class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = 0;
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;

  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly session: Session | null;
  private readonly after: number;
  private closed = false;

  constructor(url: string) {
    const parsed = new URL(url, window.location.origin);
    const id = /\/discussions\/([^/]+)\/stream/.exec(parsed.pathname)?.[1] ?? "";
    this.session = sessions.get(decodeURIComponent(id)) ?? null;
    this.after = Number(parsed.searchParams.get("after") ?? 0);
    window.setTimeout(() => void this.connect(), 0);
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
    this.detach?.();
    this.detach = null;
  }

  private detach: (() => void) | null = null;

  private dispatch(type: string, id: number | undefined, data: unknown): void {
    if (this.closed) return;
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    const event = new MessageEvent(type, {
      data: payload,
      lastEventId: id === undefined ? "" : String(id),
    });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  private async connect(): Promise<void> {
    if (!this.session) {
      this.readyState = 2;
      this.onerror?.(new Event("error"));
      return;
    }

    this.readyState = 1;
    this.onopen?.(new Event("open"));

    this.dispatch("stream.ready", undefined, {
      discussionId: this.session.id,
      status: this.session.status,
      fromSeq: this.after,
      lastSeq: this.session.seq,
      retryMs: 1000,
    });

    // Backfill everything the client missed, in order.
    for (const event of [...this.session.events]) {
      if (event.seq <= this.after) continue;
      this.dispatch(event.type, event.seq, event.payload);
      await sleep(0);
    }

    this.dispatch("stream.caught_up", undefined, {
      discussionId: this.session.id,
      lastSeq: this.session.seq,
    });

    const listener = (frame: Frame) => {
      if (frame.type === "message.delta") {
        this.dispatch(frame.type, undefined, frame.data);
        return;
      }
      this.dispatch(frame.type, frame.id, frame.data);
    };
    this.session.listeners.add(listener);
    this.detach = () => this.session?.listeners.delete(listener);
  }
}

/* ------------------------------------------------------------------ *
 * Install
 * ------------------------------------------------------------------ */

export function installMockServer(): void {
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const mocked = await handle(input, init);
    if (mocked) {
      // Mirror real latency so loading states are actually visible.
      await sleep(120);
      return mocked;
    }
    return originalFetch(input, init);
  };

  (globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;

  seed();

  // eslint-disable-next-line no-console
  console.info(
    "%c[mock api] VITE_MOCK_API=1 — 前端运行在本地模拟后端上，未连接 Fastify。",
    "color:#f0b429",
  );
}

function seed(): void {
  const seeded = createSession("AI 会不会让初级开发者失业？", 4, "seed-1");
  seeded.insights = buildInsights(seeded, 1);
  seeded.status = "live";
  seeded.startedAt = now();
  push(seeded, "discussion.started", {
    discussionId: seeded.id,
    startedAt: seeded.startedAt,
  });
  const first = SCRIPT[0];
  const speaker = seeded.experts[first.seat];
  const message: Message = {
    id: nextId("m"),
    expertId: speaker.id,
    speakerName: speaker.name,
    speakerTitle: speaker.title,
    speakerColor: speaker.color,
    content: first.text,
    intent: first.intent,
    turnIndex: 1,
    charCount: Array.from(first.text).length,
    degraded: false,
    createdAt: now(),
  };
  seeded.messages.push(message);
  seeded.turnCount = 1;
  push(seeded, "message.completed", { discussionId: seeded.id, message });

  const finished = createSession("远程办公会削弱团队创造力吗？", 4, "seed-2");
  finished.status = "ended";
  finished.startedAt = new Date(Date.now() - 3_600_000).toISOString();
  finished.endedAt = new Date(Date.now() - 3_000_000).toISOString();
  push(finished, "discussion.started", {
    discussionId: finished.id,
    startedAt: finished.startedAt,
  });
  SCRIPT.slice(0, 4).forEach((step, index) => {
    const person = finished.experts[step.seat];
    const item: Message = {
      id: nextId("m"),
      expertId: person.id,
      speakerName: person.name,
      speakerTitle: person.title,
      speakerColor: person.color,
      content: step.text,
      intent: step.intent,
      turnIndex: index + 1,
      charCount: Array.from(step.text).length,
      degraded: false,
      createdAt: new Date(Date.now() - 3_500_000 + index * 40_000).toISOString(),
    };
    finished.messages.push(item);
    finished.turnCount = index + 1;
    push(finished, "message.completed", { discussionId: finished.id, message: item });
  });
  finished.insights = buildInsights(finished, 4);
  push(finished, "insight.updated", {
    discussionId: finished.id,
    insights: finished.insights,
  });
  const summary: Summary = {
    content:
      "这场讨论的共识是：远程办公对创造力的影响取决于团队有没有刻意设计协作。主要分歧在于异步沟通是否能替代即兴碰撞。未决问题是新人如何在远程环境里获得隐性的经验。",
    createdAt: finished.endedAt,
    isFallback: false,
  };
  finished.summary = summary;
  push(finished, "summary.completed", { discussionId: finished.id, summary });
  push(finished, "discussion.ended", {
    discussionId: finished.id,
    endedAt: finished.endedAt,
  });
}
