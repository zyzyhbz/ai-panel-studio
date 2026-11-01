import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const BASE = process.env.PERF_BASE_URL ?? "http://127.0.0.1:3001";
const SESSIONS = Number(process.env.PERF_SESSIONS ?? 5);
const CONNECTIONS = Number(process.env.PERF_CONNECTIONS_PER_SESSION ?? 4);
const TIMEOUT_MS = Number(process.env.PERF_TIMEOUT_MS ?? 120000);

const sessions = [];
const connections = [];
const failures = [];
const eventCounts = new Map();
const messageLatencies = [];
const startedAt = Date.now();

function fail(message) {
  failures.push(message);
  console.error("[FAIL]", message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jsonFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { accept: "application/json", ...(options.headers ?? {}) },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body };
}

function parseSseBlock(block) {
  const event = { id: null, type: null, data: null };
  const dataLines = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event.type = line.slice(6).trim();
    else if (line.startsWith("id:")) event.id = Number(line.slice(3).trim());
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length > 0) {
    try {
      event.data = JSON.parse(dataLines.join("\n"));
    } catch {
      event.data = dataLines.join("\n");
    }
  }
  return event.type ? event : null;
}

async function connect(session, index) {
  const controller = new AbortController();
  const rec = { sessionId: session.id, index, controller, closed: false, lastSeq: 0, events: [], readPromise: null };
  connections.push(rec);

  const url = `${BASE}/api/discussions/${session.id}/stream?after=0`;
  const res = await fetch(url, {
    headers: { accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (!res.ok || !res.body) {
    fail(`SSE connect ${session.id}#${index} failed: HTTP ${res.status}`);
    return rec;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  rec.readPromise = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const event = parseSseBlock(block);
          if (!event || !event.type) continue;
          rec.events.push(event);
          if (event.type === "stream.ready" || event.type === "stream.caught_up") continue;

          const payload = event.data ?? {};
          if (payload.discussionId !== session.id) {
            fail(`cross-talk: ${session.id}#${index} got discussionId=${payload.discussionId}`);
          }
          if (typeof event.id === "number") {
            if (event.id <= rec.lastSeq) {
              fail(`non-monotonic/duplicate seq on ${session.id}#${index}: ${rec.lastSeq} -> ${event.id}`);
            }
            rec.lastSeq = event.id;
          }
          const key = `${session.id}:${event.type}`;
          eventCounts.set(key, (eventCounts.get(key) ?? 0) + 1);
          if (event.type === "message.completed") {
            const createdAt = payload.message?.createdAt;
            if (createdAt) {
              const latency = Date.now() - Date.parse(createdAt);
              if (Number.isFinite(latency)) messageLatencies.push(latency);
            }
          }
          if (event.type === "discussion.ended" || event.type === "discussion.failed") {
            session.terminal = event.type;
          }
        }
      }
    } catch (error) {
      if (error?.name !== "AbortError") fail(`SSE read ${session.id}#${index}: ${error.message}`);
    } finally {
      rec.closed = true;
    }
  })();

  return rec;
}

async function main() {
  console.log(`[perf] base=${BASE} sessions=${SESSIONS} connections/session=${CONNECTIONS}`);

  for (let i = 0; i < SESSIONS; i += 1) {
    const { res, body } = await jsonFetch("/api/discussions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-qa-scenario": "slow" },
      body: JSON.stringify({
        topic: `并发压力测试 ${i + 1}：AI 圆桌能否在多人团队中提升决策质量？`,
        expertCount: 4,
        clientRequestId: crypto.randomUUID(),
      }),
    });
    if (!res.ok) {
      fail(`create #${i + 1}: HTTP ${res.status} ${JSON.stringify(body)}`);
      continue;
    }
    const session = {
      id: body.discussion.id,
      topic: body.discussion.topic,
      status: body.discussion.status,
      terminal: null,
    };
    sessions.push(session);
  }

  for (const session of sessions) {
    const { res, body } = await jsonFetch(`/api/discussions/${session.id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!res.ok) fail(`confirm ${session.id}: HTTP ${res.status} ${JSON.stringify(body)}`);
    session.status = body?.discussion?.status ?? session.status;
  }

  // Open 4 independent SSE clients per session (20 total).
  await Promise.all(
    sessions.flatMap((session) =>
      Array.from({ length: CONNECTIONS }, (_, index) => connect(session, index)),
    ),
  );

  await sleep(800);
  const health = await jsonFetch("/api/health");
  const activeSseCount = health.body?.activeSseCount;
  console.log(`[perf] activeSseCount=${activeSseCount}`);

  const deadline = startedAt + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (sessions.every((s) => s.terminal)) break;
    await sleep(500);
  }

  for (const session of sessions) {
    for (const rec of connections.filter((c) => c.sessionId === session.id)) rec.controller.abort();
  }
  await Promise.all(connections.map((c) => c.readPromise).filter(Boolean));
  await sleep(500);

  for (const session of sessions) {
    if (!session.terminal) fail(`session ${session.id} did not reach terminal state`);
    const ended = eventCounts.get(`${session.id}:discussion.ended`) ?? 0;
    const failed = eventCounts.get(`${session.id}:discussion.failed`) ?? 0;
    const completed = eventCounts.get(`${session.id}:message.completed`) ?? 0;
    const insights = eventCounts.get(`${session.id}:insight.updated`) ?? 0;
    const summary = eventCounts.get(`${session.id}:summary.completed`) ?? 0;
    if (ended === 0 && failed === 0) fail(`session ${session.id} has no terminal event`);
    if (completed === 0) fail(`session ${session.id} has no message.completed`);
    if (insights === 0) fail(`session ${session.id} has no insight.updated`);
    if (summary === 0) fail(`session ${session.id} has no summary.completed`);
    console.log(
      `[perf] ${session.id} terminal=${session.terminal} completed=${completed} insight.updated=${insights} summary=${summary}`,
    );
  }

  const sorted = [...messageLatencies].sort((a, b) => a - b);
  const p95 = sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : null;
  const max = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const connectionCount = connections.filter((c) => c.events.some((e) => e.type === "stream.ready")).length;

  const report = {
    ok: failures.length === 0,
    base: BASE,
    sessions: sessions.length,
    connections: connectionCount,
    expectedConnections: SESSIONS * CONNECTIONS,
    activeSseCount,
    terminated: sessions.filter((s) => s.terminal).length,
    failures,
    messageDeliveryLatencyMs: { p95, max, samples: messageLatencies.length },
    durationMs: Date.now() - startedAt,
    events: Object.fromEntries(eventCounts),
  };

  const out = resolve(process.cwd(), "data/perf-report.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(`[perf] ${report.ok ? "PASS" : "FAIL"} connections=${connectionCount}/${report.expectedConnections} duration=${report.durationMs}ms`);
  console.log(`[perf] latency p95=${p95}ms max=${max}ms; report=${out}`);
  if (!report.ok) process.exitCode = 1;
}

await main();
