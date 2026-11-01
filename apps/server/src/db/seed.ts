import { loadConfig, loadEnvFiles } from "../config/env";
import { openDb } from "./connection";
import { migrate } from "./migrate";
import { seed } from "./seed-data";

const isCli = process.argv[1]?.replace(/\\/g, "/").endsWith("/db/seed.ts") ?? false;

if (isCli) {
  loadEnvFiles();
  const config = loadConfig();
  const force = process.argv.includes("--force");
  const db = openDb({ path: config.databasePath });
  try {
    const migration = migrate(db);
    const report = seed(db, { force });
    console.log(
      JSON.stringify({
        ok: true,
        dbPath: config.databasePath,
        migration,
        ...report,
      }),
    );
  } finally {
    db.close();
  }
}
