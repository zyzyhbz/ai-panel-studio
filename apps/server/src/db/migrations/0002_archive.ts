/**
 * Migration 0002 — archive support (PM 2026-11-01).
 *
 * Archiving is a presentation concern, not a discussion state: it must never
 * change `status` or interrupt a live session. `archived_at IS NULL` means the
 * discussion is visible in the main lobby.
 */
export const SQL_0002_ARCHIVE = `
ALTER TABLE discussions ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_discussions_archived_updated
  ON discussions (archived_at, updated_at DESC);
`;
