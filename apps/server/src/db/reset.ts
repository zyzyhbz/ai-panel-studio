import { existsSync, rmSync } from "node:fs";
import { loadConfig, loadEnvFiles } from "../config/env";
import { openDb } from "./connection";
import { migrate } from "./migrate";
import { seed } from "./seed-data";

const isCli = process.argv[1]?.replace(/\\/g, "/").endsWith("/db/reset.ts") ?? false;

if (isCli) {
  loadEnvFiles();
  const config = loadConfig();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${config.databasePath}${suffix}`;
    if (existsSync(file)) rmSync(file, { force: true });
  }
  const db = openDb({ path: config.databasePath });
  try {
    const migration = migrate(db);
    const report = seed(db, { force: true });
    console.log(
      JSON.stringify({ ok: true, reset: true, dbPath: config.databasePath, migration, ...report }),
    );
  } finally {
    db.close();
  }
}
