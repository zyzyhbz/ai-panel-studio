import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { AppContext, CoreDeps, Logger } from "./context";
import { loadConfig, type AppConfig } from "./config/env";
import { openDb, type Db } from "./db/connection";
import { migrate } from "./db/migrate";
import { AppError, toErrorBody, type ApiErrorCode } from "./http/errors";
import { systemClock, type Clock } from "./lib/clock";
import { createLlmClient } from "./llm/factory";
import type { LLMClient } from "./llm/types";
import { createBroadcaster } from "./session/broadcaster";
import { createSessionManager } from "./session/session-manager";
import { recoverOnBoot } from "./session/recovery";
import { createEventService } from "./services/event.service";
import { createInsightService } from "./services/insight.service";
import { createSummaryService } from "./services/summary.service";
import { createRosterService } from "./services/roster.service";
import { createDiscussionService } from "./services/discussion.service";
import { createDiscussionsRepo } from "./repositories/discussions.repo";
import { createEventsRepo } from "./repositories/events.repo";
import { createExpertsRepo } from "./repositories/experts.repo";
import { createInsightsRepo } from "./repositories/insights.repo";
import { createMessagesRepo } from "./repositories/messages.repo";
import { createSummariesRepo } from "./repositories/summaries.repo";
import { registerDiscussionRoutes } from "./routes/discussions";
import { registerHealthRoutes } from "./routes/health";
import { registerStreamRoute } from "./routes/stream";

export interface BuildAppOptions {
  /** Pre-built config (tests); otherwise derived from env. */
  config?: AppConfig;
  env?: NodeJS.ProcessEnv;
  /** Injected DB (tests): caller owns lifecycle and closing. */
  db?: Db;
  clock?: Clock;
  llm?: LLMClient;
  logger?: boolean | Logger;
  /** Run boot recovery + watchdog (disabled for most unit tests). */
  recover?: boolean;
}

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
  close(): Promise<void>;
}

const NOOP_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

export async function buildApp(options: BuildAppOptions = {}): Promise<BuiltApp> {
  const config = options.config ?? loadConfig(options.env ?? process.env);
  const clock = options.clock ?? systemClock;
  const ownsDb = !options.db;
  const db = options.db ?? openDb({ path: config.databasePath });
  migrate(db);

  const llm = options.llm ?? createLlmClient(config);

  const app = Fastify({
    bodyLimit: 16 * 1024,
    genReqId: () => randomUUID(),
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "*.apiKey",
                "*.api_key",
                "*.reasoning_content",
              ],
              censor: "[REDACTED]",
            },
          },
  });

  /**
   * No-body POSTs (`confirm`, `end`, `roster/regenerate`) must tolerate whatever
   * Content-Type a tool sends. Without this, `Invoke-RestMethod -Method Post` or
   * `curl -X POST` with a default form content-type dies with 415 before reaching
   * the handler, and an empty JSON body dies with 400.
   */
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, body, done) => {
      const text = typeof body === "string" ? body : "";
      if (text.trim().length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(text) as unknown);
      } catch {
        done(Object.assign(new Error("请求体不是合法 JSON"), { statusCode: 400 }), undefined);
      }
    },
  );
  for (const contentType of ["application/x-www-form-urlencoded", "text/plain"]) {
    app.addContentTypeParser(contentType, { parseAs: "string" }, (_request, _body, done) => {
      done(null, {});
    });
  }

  const log: Logger = options.logger === false ? NOOP_LOGGER : (app.log as unknown as Logger);

  const repos = {
    discussions: createDiscussionsRepo(db),
    experts: createExpertsRepo(db),
    messages: createMessagesRepo(db),
    insights: createInsightsRepo(db),
    events: createEventsRepo(db),
    summaries: createSummariesRepo(db),
  };

  const broadcaster = createBroadcaster();
  const events = createEventService({
    clock,
    events: repos.events,
    discussions: repos.discussions,
    sink: {
      emitPersisted: (discussionId, frame) => {
        broadcaster.emitPersisted(discussionId, {
          seq: frame.seq,
          type: frame.type,
          dataJson: frame.dataJson,
        });
      },
    },
  });

  const core: CoreDeps = { config, db, clock, llm, repos, events, broadcaster, log };

  const insights = createInsightService(core);
  const summary = createSummaryService(core);
  const roster = createRosterService(core);
  const sessions = createSessionManager({ ...core, insights, summary });
  const discussions = createDiscussionService({ ...core, roster, sessions });

  const ctx: AppContext = {
    ...core,
    sessions,
    services: { roster, discussions, insights, summary },
    startedAt: Date.now(),
  };

  if (options.recover !== false) {
    recoverOnBoot(core);
  }

  await app.register(cors, {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST", "OPTIONS"],
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Request-Id", String(request.id));
    if (request.url.startsWith("/api")) {
      reply.header("Cache-Control", "no-store");
    }
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = String(request.id);
    if (error instanceof AppError) {
      if (error.status >= 500) {
        request.log.error({ err: error.message, code: error.code }, "request failed");
      }
      reply.code(error.status);
      return toErrorBody(error, requestId);
    }

    const fastifyCode = (error as { code?: string }).code;
    if (fastifyCode === "FST_ERR_CTP_BODY_TOO_LARGE") {
      const mapped = new AppError("PAYLOAD_TOO_LARGE");
      reply.code(mapped.status);
      return toErrorBody(mapped, requestId);
    }
    if (
      fastifyCode === "FST_ERR_CTP_INVALID_MEDIA_TYPE" ||
      fastifyCode === "FST_ERR_CTP_EMPTY_JSON_BODY"
    ) {
      const mapped = new AppError(
        fastifyCode === "FST_ERR_CTP_EMPTY_JSON_BODY" ? "VALIDATION_ERROR" : "UNSUPPORTED_MEDIA_TYPE",
      );
      reply.code(mapped.status);
      return toErrorBody(mapped, requestId);
    }
    if ((error as { validation?: unknown }).validation) {
      const mapped = new AppError("VALIDATION_ERROR");
      reply.code(mapped.status);
      return toErrorBody(mapped, requestId);
    }
    // Body-parser errors carry statusCode 400 and must not surface as 500.
    if ((error as { statusCode?: number }).statusCode === 400) {
      const mapped = new AppError("VALIDATION_ERROR", "请求体不合法");
      reply.code(mapped.status);
      return toErrorBody(mapped, requestId);
    }

    request.log.error({ err: (error as Error).message }, "unhandled error");
    const mapped = new AppError("INTERNAL");
    reply.code(mapped.status);
    return toErrorBody(mapped, requestId);
  });

  app.setNotFoundHandler((request, reply) => {
    const mapped = new AppError("NOT_FOUND", "接口不存在");
    reply.code(mapped.status);
    return toErrorBody(mapped, String(request.id));
  });

  registerHealthRoutes(app, ctx);
  registerDiscussionRoutes(app, ctx);
  registerStreamRoute(app, ctx);

  const stopWatchdog = options.recover === false ? () => undefined : sessions.startWatchdog();

  app.addHook("onClose", async () => {
    stopWatchdog();
    await sessions.stopAll();
    broadcaster.closeAll();
    if (ownsDb) db.close();
  });

  await app.ready();

  return {
    app,
    ctx,
    close: async () => {
      await app.close();
    },
  };
}

export type { ApiErrorCode };
