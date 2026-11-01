import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context";
import { inspectDb } from "../db/connection";

const VERSION = "0.1.0";

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/health", async () => {
    const db = inspectDb(ctx.db);
    return {
      status: db.ready ? "ok" : "degraded",
      version: VERSION,
      llmMode: ctx.llm.mode,
      dbReady: db.ready,
      dbSchemaVersion: db.schemaVersion,
      dbJournalMode: db.journalMode,
      activeSseCount: ctx.broadcaster.count(),
      activeSessions: ctx.sessions.activeCount(),
      uptimeMs: Date.now() - ctx.startedAt,
      rssBytes: process.memoryUsage().rss,
      now: ctx.clock(),
    };
  });
}
