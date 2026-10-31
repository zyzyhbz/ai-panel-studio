import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

export interface OpenDbOptions {
  /** File path, or ":memory:" for throwaway unit tests. */
  path: string;
  readonly?: boolean;
  /** busy_timeout in ms; 0 disables. */
  busyTimeoutMs?: number;
}

/**
 * Open SQLite with the pragmas this app depends on.
 *
 * `foreign_keys` is PER CONNECTION — it must be set on every open or FK
 * enforcement silently disappears (and roster replacement would corrupt data).
 */
export function openDb(options: OpenDbOptions): Db {
  const { path, readonly = false, busyTimeoutMs = 5_000 } = options;
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, { readonly, fileMustExist: false });
  try {
    if (!readonly) {
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
      db.pragma("wal_autocheckpoint = 1000");
    }
    db.pragma(`busy_timeout = ${busyTimeoutMs}`);
    db.pragma("foreign_keys = ON");
    // Named columns + real types makes driver results predictable.
    db.defaultSafeIntegers(false);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

export interface DbStatus {
  ready: boolean;
  journalMode: string;
  foreignKeys: boolean;
  schemaVersion: number;
  error?: string;
}

export function inspectDb(db: Db): DbStatus {
  try {
    const journalMode = String(db.pragma("journal_mode", { simple: true }));
    const foreignKeys = Number(db.pragma("foreign_keys", { simple: true })) === 1;
    const row = db
      .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations")
      .get() as { v: number } | undefined;
    return { ready: true, journalMode, foreignKeys, schemaVersion: row?.v ?? 0 };
  } catch (error) {
    return {
      ready: false,
      journalMode: "unknown",
      foreignKeys: false,
      schemaVersion: 0,
      error: error instanceof Error ? error.message : "unknown",
    };
  }
}
