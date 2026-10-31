import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { APP_NAME } from "@ai-panel/shared";

const rootEnv = resolve(import.meta.dirname, "../../../.env.local");
const rootEnvFallback = resolve(import.meta.dirname, "../../../.env");
if (existsSync(rootEnv)) loadEnv({ path: rootEnv });
else if (existsSync(rootEnvFallback)) loadEnv({ path: rootEnvFallback });

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const startedAt = Date.now();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
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

await app.register(cors, {
  origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
});

app.get("/api/health", async () => ({
  status: "ok",
  app: APP_NAME,
  version: "0.1.0",
  llmMode: process.env.LLM_MODE ?? "mock",
  dbReady: false,
  activeSseCount: 0,
  uptimeMs: Date.now() - startedAt,
  rssBytes: process.memoryUsage().rss,
  now: new Date().toISOString(),
}));

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
