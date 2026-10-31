import type { Intent } from "@ai-panel/shared";
import type { Db } from "../db/connection";
import type { MessageRecord } from "../types";

export interface MessageInput {
  id: string;
  discussionId: string;
  expertId: string;
  turnIndex: number;
  intent: Intent;
  content: string;
  charCount: number;
  degraded: boolean;
  targetMessageId: string | null;
  references: readonly string[];
  createdAt: string;
}

interface MessageRow {
  id: string;
  discussion_id: string;
  expert_id: string;
  turn_index: number;
  intent: Intent;
  content: string;
  char_count: number;
  degraded: number;
  target_message_id: string | null;
  references_json: string;
  created_at: string;
}

const COLUMNS = `id, discussion_id, expert_id, turn_index, intent, content, char_count,
  degraded, target_message_id, references_json, created_at`;

function map(row: MessageRow): MessageRecord {
  let references: string[] = [];
  try {
    const parsed = JSON.parse(row.references_json) as unknown;
    if (Array.isArray(parsed)) references = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    references = [];
  }
  return {
    id: row.id,
    discussionId: row.discussion_id,
    expertId: row.expert_id,
    turnIndex: row.turn_index,
    intent: row.intent,
    content: row.content,
    charCount: row.char_count,
    degraded: row.degraded === 1,
    targetMessageId: row.target_message_id,
    references,
    createdAt: row.created_at,
  };
}

export function createMessagesRepo(db: Db) {
  const insertStmt = db.prepare(
    `INSERT INTO messages (${COLUMNS})
     VALUES (@id, @discussion_id, @expert_id, @turn_index, @intent, @content, @char_count,
             @degraded, @target_message_id, @references_json, @created_at)`,
  );
  const listStmt = db.prepare(
    `SELECT ${COLUMNS} FROM messages WHERE discussion_id = ? ORDER BY turn_index ASC`,
  );
  const recentStmt = db.prepare(
    `SELECT ${COLUMNS} FROM (SELECT ${COLUMNS} FROM messages WHERE discussion_id = ?
      ORDER BY turn_index DESC LIMIT ?) ORDER BY turn_index ASC`,
  );

  return {
    insert(input: MessageInput): MessageRecord {
      insertStmt.run({
        id: input.id,
        discussion_id: input.discussionId,
        expert_id: input.expertId,
        turn_index: input.turnIndex,
        intent: input.intent,
        content: input.content,
        char_count: input.charCount,
        degraded: input.degraded ? 1 : 0,
        target_message_id: input.targetMessageId,
        references_json: JSON.stringify(input.references),
        created_at: input.createdAt,
      });
      const row = db
        .prepare(`SELECT ${COLUMNS} FROM messages WHERE id = ?`)
        .get(input.id) as MessageRow | undefined;
      if (!row) throw new Error("message insert failed");
      return map(row);
    },

    listByDiscussion(discussionId: string): MessageRecord[] {
      return (listStmt.all(discussionId) as MessageRow[]).map(map);
    },

    /** Ascending window of the newest N messages (for context assembly). */
    recent(discussionId: string, limit: number): MessageRecord[] {
      return (recentStmt.all(discussionId, limit) as MessageRow[]).map(map);
    },

    countByDiscussion(discussionId: string): number {
      const row = db
        .prepare("SELECT COUNT(*) AS c FROM messages WHERE discussion_id = ?")
        .get(discussionId) as { c: number };
      return row.c;
    },

    idSet(discussionId: string): Set<string> {
      const rows = db
        .prepare("SELECT id FROM messages WHERE discussion_id = ?")
        .all(discussionId) as { id: string }[];
      return new Set(rows.map((r) => r.id));
    },

    getById(discussionId: string, id: string): MessageRecord | null {
      const row = db
        .prepare(`SELECT ${COLUMNS} FROM messages WHERE discussion_id = ? AND id = ?`)
        .get(discussionId, id) as MessageRow | undefined;
      return row ? map(row) : null;
    },
  };
}

export type MessagesRepo = ReturnType<typeof createMessagesRepo>;
