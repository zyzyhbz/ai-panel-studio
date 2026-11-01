import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context";
import { AppError, toErrorBody } from "../http/errors";
import { idParamSchema, parseInput, streamQuerySchema } from "../http/validation";
import type { BroadcastFrame, Subscription } from "../session/broadcaster";
import { TERMINAL_EVENTS } from "../services/event.service";

const MAX_PENDING_BYTES = 1 << 20;

function parseLastEventId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * SSE endpoint.
 *
 * Handshake order is load-bearing (BACKEND-PLAN §5.2):
 *   subscribe (buffering) -> replay from SQLite -> stream.caught_up -> goLive.
 * The replay path is fully synchronous, so no event can slip between the last
 * replayed row and the first live frame.
 */
export function registerStreamRoute(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/discussions/:id/stream", async (request, reply) => {
    const { id } = parseInput(idParamSchema, request.params);
    const query = parseInput(streamQuerySchema, request.query ?? {});

    const discussion = ctx.repos.discussions.getById(id);
    if (!discussion) {
      reply.code(404).type("application/json; charset=utf-8");
      return toErrorBody(new AppError("NOT_FOUND"), String(request.id));
    }
    if (ctx.broadcaster.countFor(id) >= ctx.config.sse.maxConnections) {
      reply.code(429).type("application/json; charset=utf-8");
      return toErrorBody(new AppError("SSE_LIMIT_REACHED"), String(request.id));
    }

    const after = Math.max(
      query.after ?? discussion.lastSeq,
      parseLastEventId(request.headers["last-event-id"]) ?? 0,
    );

    const res = reply.raw;
    reply.hijack();
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Request-Id": String(request.id),
    });
    res.socket?.setNoDelay(true);
    res.write(`retry: ${ctx.config.sse.retryMs}\n\n`);

    let closed = false;
    let lastSent = after;
    let sub: Subscription | null = null;
    let timer: NodeJS.Timeout | undefined;

    function cleanup(): void {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      const handle = sub;
      sub = null;
      handle?.unsubscribe();
    }

    function endResponse(): void {
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          /* socket already gone */
        }
      }
    }

    function finish(): void {
      cleanup();
      endResponse();
    }

    function terminate(): void {
      cleanup();
      if (!res.writableEnded) res.destroy();
    }

    function writeFrame(frame: BroadcastFrame): void {
      if (closed) return;
      if (frame.seq !== null) {
        if (frame.seq <= lastSent) return; // client already has it
        lastSent = frame.seq;
      }
      const idLine = frame.seq === null ? "" : `id: ${frame.seq}\n`;
      try {
        res.write(`${idLine}event: ${frame.type}\ndata: ${frame.dataJson}\n\n`);
      } catch {
        terminate();
        return;
      }
      if (res.writableLength > MAX_PENDING_BYTES) {
        terminate();
        return;
      }
      if (frame.type === "discussion.ended" || frame.type === "discussion.failed") {
        finish();
      }
    }

    sub = ctx.broadcaster.subscribe(id, writeFrame, () => {
      if (!closed) {
        cleanup();
        endResponse();
      }
    });
    request.raw.on("close", cleanup);

    // Subscribe BEFORE reading lastSeq: anything appended in between is buffered
    // and deduped by seq, so the replay can never leave a hole.
    const snapshotLastSeq = ctx.repos.events.lastSeq(id);

    writeFrame({
      seq: null,
      type: "stream.ready",
      dataJson: JSON.stringify({
        discussionId: id,
        status: discussion.status,
        lastSeq: snapshotLastSeq,
        fromSeq: after,
        retryMs: ctx.config.sse.retryMs,
      }),
    });

    const replay = ctx.repos.events.listAfter(id, after, ctx.config.sse.replayLimit);
    for (const event of replay.items) {
      writeFrame({ seq: event.seq, type: event.type, dataJson: event.payloadJson });
      if (closed) break;
    }

    if (!closed) {
      writeFrame({
        seq: null,
        type: "stream.caught_up",
        dataJson: JSON.stringify({ discussionId: id, lastSeq: lastSent }),
      });
    }

    if (closed) return reply;

    const overflowed = sub.goLive();
    if (overflowed) {
      finish();
      return reply;
    }

    timer = setInterval(() => {
      if (closed) return;
      try {
        res.write(": heartbeat\n\n");
        if (res.writableLength > MAX_PENDING_BYTES) terminate();
      } catch {
        terminate();
      }
    }, ctx.config.sse.heartbeatMs);
    timer.unref?.();

    const terminal = discussion.status === "ended" || discussion.status === "failed";
    if (terminal && lastSent >= snapshotLastSeq) finish();

    return reply;
  });
}

export { TERMINAL_EVENTS };
