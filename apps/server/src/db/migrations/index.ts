import { SQL_0001_INIT } from "./0001_init.js";
import { SQL_0002_ARCHIVE } from "./0002_archive.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Ordered, immutable list. Never edit a released migration; append a new one. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "init", sql: SQL_0001_INIT },
  { version: 2, name: "archive", sql: SQL_0002_ARCHIVE },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
