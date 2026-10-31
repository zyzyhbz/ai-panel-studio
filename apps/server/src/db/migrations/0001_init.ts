/**
 * Migration 0001 — initial schema (G1 contract v1.0, docs/06-G1契约决议.md).
 *
 * Invariants encoded here on purpose:
 * - status is a closed enum at the DB level (no typo can corrupt the state machine).
 * - (discussion_id, seq) is unique  -> event stream is append-only and gap-free.
 * - (discussion_id, turn_index) is unique on messages -> aborted turns never consume an index.
 * - experts.id is RESTRICTed from messages -> a roster can never be replaced once it has spoken.
 * - insights carry content_hash -> the same consensus keeps the same id across snapshots.
 */
export const SQL_0001_INIT = `
CREATE TABLE IF NOT EXISTS discussions (
  id                TEXT PRIMARY KEY,
  client_request_id TEXT NOT NULL UNIQUE,
  topic             TEXT NOT NULL,
  status            TEXT NOT NULL
    CHECK (status IN ('generating','ready','live','summarizing','ended','failed')),
  expert_count      INTEGER NOT NULL CHECK (expert_count BETWEEN 3 AND 6),
  planned_turns     INTEGER NOT NULL,
  turn_count        INTEGER NOT NULL DEFAULT 0 CHECK (turn_count >= 0),
  last_seq          INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  qa_scenario       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  started_at        TEXT,
  ended_at          TEXT,
  error_code        TEXT,
  error_message     TEXT
);

CREATE INDEX IF NOT EXISTS idx_discussions_status_updated
  ON discussions (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_discussions_updated
  ON discussions (updated_at DESC);

CREATE TABLE IF NOT EXISTS experts (
  id            TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('host','expert')),
  name          TEXT NOT NULL,
  profession    TEXT NOT NULL,
  title         TEXT NOT NULL,
  stance        TEXT NOT NULL,
  stance_axis   TEXT NOT NULL,
  polarity      TEXT NOT NULL
    CHECK (polarity IN ('strong_oppose','oppose','neutral','support','strong_support')),
  focus_area    TEXT NOT NULL,
  color         TEXT NOT NULL,
  sort_order    INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (discussion_id, color),
  UNIQUE (discussion_id, name)
);

CREATE INDEX IF NOT EXISTS idx_experts_discussion_order
  ON experts (discussion_id, sort_order);

CREATE TABLE IF NOT EXISTS messages (
  id                TEXT PRIMARY KEY,
  discussion_id     TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  expert_id         TEXT NOT NULL REFERENCES experts(id) ON DELETE RESTRICT,
  turn_index        INTEGER NOT NULL CHECK (turn_index >= 1),
  intent            TEXT NOT NULL,
  content           TEXT NOT NULL,
  char_count        INTEGER NOT NULL CHECK (char_count >= 0),
  degraded          INTEGER NOT NULL DEFAULT 0 CHECK (degraded IN (0,1)),
  target_message_id TEXT,
  references_json   TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL,
  UNIQUE (discussion_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_messages_discussion_created
  ON messages (discussion_id, created_at);

CREATE TABLE IF NOT EXISTS insights (
  id              TEXT PRIMARY KEY,
  discussion_id   TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('consensus','divergence','open_question')),
  content         TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  first_seen_turn INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (discussion_id, type, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_insights_discussion_created
  ON insights (discussion_id, created_at);

CREATE TABLE IF NOT EXISTS insight_evidence (
  insight_id TEXT NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  PRIMARY KEY (insight_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_insight_evidence_message
  ON insight_evidence (message_id);

CREATE TABLE IF NOT EXISTS summaries (
  discussion_id TEXT PRIMARY KEY REFERENCES discussions(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  is_fallback   INTEGER NOT NULL DEFAULT 0 CHECK (is_fallback IN (0,1)),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL CHECK (seq >= 1),
  type          TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (discussion_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_events_discussion_type
  ON events (discussion_id, type);
`;
