import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { openDb, type Db } from "./connection.js";
import { LATEST_VERSION, MIGRATIONS } from "./migrations/index.js";

export interface MigrateResult {
  applied: number[];
  currentVersion: number;
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex").slice(0, 16);
}

/**
 * Idempotent forward-only migration runner.
 * Each migration runs inside its own transaction together with its bookkeeping row,
 * so a crash can never leave a half-applied schema version.
 */
export function migrate(db: Db): MigrateResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const done = new Map<number, string>();
  const rows = db.prepare("SELECT version, checksum FROM schema_migrations").all() as {
    version: number;
    checksum: string;
  }[];
  for (const row of rows) done.set(row.version, row.checksum);

  const applied: number[] = [];
  for (const migration of MIGRATIONS) {
    const sum = checksum(migration.sql);
    const existing = done.get(migration.version);
    if (existing) {
      if (existing !== sum) {
        throw new Error(
          `migration ${migration.version} checksum mismatch (was ${existing}, now ${sum}); migrations are immutable`,
        );
      }
      continue;
    }
    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?,?,?,?)",
      ).run(migration.version, migration.name, sum, new Date().toISOString());
    });
    run();
    applied.push(migration.version);
  }

  return { applied, currentVersion: LATEST_VERSION };
}

export function currentVersion(db: Db): number {
  try {
    const row = db
      .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations")
      .get() as { v: number } | undefined;
    return row?.v ?? 0;
  } catch {
    return 0;
  }
}

const isCli = process.argv[1]?.replace(/\\/g, "/").endsWith("/db/migrate.ts") ?? false;

if (isCli) {
  const dbPath =
    process.env.DATABASE_PATH ?? resolve(process.cwd(), "../../data/app.db");
  const db = openDb({ path: dbPath });
  try {
    const result = migrate(db);
    console.log(
      JSON.stringify({
        ok: true,
        dbPath,
        applied: result.applied,
        currentVersion: result.currentVersion,
      }),
    );
  } finally {
    db.close();
  }
}
