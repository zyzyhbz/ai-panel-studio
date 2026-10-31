import type { Db } from "../db/connection";
import type { StoredEventRecord } from "../types";

interface EventRow {
  id: string;
  discussion_id: string;
  seq: number;
  type: string;
  payload_json: string;
  created_at: string;
}

const COLUMNS = "id, discussion_id, seq, type, payload_json, created_at";

function map(row: EventRow): StoredEventRecord {
  return {
    id: row.id,
    discussionId: row.discussion_id,
    seq: row.seq,
    type: row.type,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
  };
}

export function createEventsRepo(db: Db) {
  const nextSeqStmt = db.prepare(
    "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM events WHERE discussion_id = ?",
  );
  const insertStmt = db.prepare(
    `INSERT INTO events (${COLUMNS})
     VALUES (@id, @discussion_id, @seq, @type, @payload_json, @created_at)`,
  );
  const syncLastSeqStmt = db.prepare("UPDATE discussions SET last_seq = ? WHERE id = ?");
  const lastSeqStmt = db.prepare(
    "SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE discussion_id = ?",
  );

  /**
   * Append one persisted semantic event and bump discussions.last_seq.
   *
   * MUST stay synchronous (no await) and run inside one transaction: that is what
   * makes seq allocation race-free in a single-process Node server.
   *
   * `payloadJson` is stored verbatim and later written verbatim into the SSE
   * `data:` field, which is what makes replay and live share one reducer.
   */
  const appendTx = db.transaction(
    (input: {
      id: string;
      discussionId: string;
      type: string;
      payloadJson: string;
      createdAt: string;
    }): { seq: number; createdAt: string } => {
      const { seq } = nextSeqStmt.get(input.discussionId) as { seq: number };
      insertStmt.run({
        id: input.id,
        discussion_id: input.discussionId,
        seq,
        type: input.type,
        payload_json: input.payloadJson,
        created_at: input.createdAt,
      });
      syncLastSeqStmt.run(seq, input.discussionId);
      return { seq, createdAt: input.createdAt };
    },
  );

  return {
    append(input: {
      id: string;
      discussionId: string;
      type: string;
      payloadJson: string;
      createdAt: string;
    }): { seq: number; createdAt: string } {
      return appendTx(input);
    },

    lastSeq(discussionId: string): number {
      return (lastSeqStmt.get(discussionId) as { seq: number }).seq;
    },

    listAfter(
      discussionId: string,
      after: number,
      limit: number,
    ): { items: StoredEventRecord[]; hasMore: boolean } {
      const rows = db
        .prepare(
          `SELECT ${COLUMNS} FROM events
            WHERE discussion_id = ? AND seq > ?
            ORDER BY seq ASC LIMIT ?`,
        )
        .all(discussionId, after, limit + 1) as EventRow[];
      const hasMore = rows.length > limit;
      return { items: rows.slice(0, limit).map(map), hasMore };
    },

    /** Whole log for projection/state rebuilding (sessions are small: < 100 events). */
    listAll(discussionId: string): StoredEventRecord[] {
      return (
        db
          .prepare(
            `SELECT ${COLUMNS} FROM events WHERE discussion_id = ? ORDER BY seq ASC`,
          )
          .all(discussionId) as EventRow[]
      ).map(map);
    },

    findByType(discussionId: string, type: string): StoredEventRecord | null {
      const row = db
        .prepare(
          `SELECT ${COLUMNS} FROM events WHERE discussion_id = ? AND type = ?
            ORDER BY seq DESC LIMIT 1`,
        )
        .get(discussionId, type) as EventRow | undefined;
      return row ? map(row) : null;
    },

    hasType(discussionId: string, type: string): boolean {
      return Boolean(
        db
          .prepare("SELECT 1 FROM events WHERE discussion_id = ? AND type = ? LIMIT 1")
          .get(discussionId, type),
      );
    },

    countByDiscussion(discussionId: string): number {
      return (lastSeqStmt.get(discussionId) as { seq: number }).seq;
    },
  };
}

export type EventsRepo = ReturnType<typeof createEventsRepo>;
