import { buildApp } from "./app";
import { ConfigError, loadConfig, loadEnvFiles } from "./config/env";

async function main(): Promise<void> {
  loadEnvFiles();

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // Deliberately no stack trace and no env dump: it may contain the Key.
      console.error(`[config] ${error.code}: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const built = await buildApp({ config });
  for (const warning of config.warnings) {
    built.app.log.warn(warning);
  }
  built.app.log.info(
    {
      llmMode: config.llm.mode,
      model: config.llm.model,
      thinking: config.llm.thinking,
      database: config.databasePath,
    },
    "starting server",
  );

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    built.app.log.info({ signal }, "shutting down");
    try {
      await built.close();
    } catch (error) {
      built.app.log.error({ err: (error as Error).message }, "shutdown failed");
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await built.app.listen({ port: config.port, host: config.host });
  } catch (error) {
    built.app.log.error({ err: (error as Error).message }, "failed to listen");
    process.exit(1);
  }
}

await main();
