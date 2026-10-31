import type { Db } from "../db/connection";
import type { SummaryRecord } from "../types";

interface SummaryRow {
  discussion_id: string;
  content: string;
  is_fallback: number;
  created_at: string;
}

export function createSummariesRepo(db: Db) {
  const getStmt = db.prepare(
    "SELECT discussion_id, content, is_fallback, created_at FROM summaries WHERE discussion_id = ?",
  );
  const upsertStmt = db.prepare(
    `INSERT INTO summaries (discussion_id, content, is_fallback, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(discussion_id) DO UPDATE SET
       content = excluded.content,
       is_fallback = excluded.is_fallback,
       created_at = excluded.created_at`,
  );

  return {
    get(discussionId: string): SummaryRecord | null {
      const row = getStmt.get(discussionId) as SummaryRow | undefined;
      if (!row) return null;
      return {
        discussionId: row.discussion_id,
        content: row.content,
        isFallback: row.is_fallback === 1,
        createdAt: row.created_at,
      };
    },

    upsert(discussionId: string, content: string, isFallback: boolean, now: string): void {
      upsertStmt.run(discussionId, content, isFallback ? 1 : 0, now);
    },

    /** Batched previews for the list endpoint. */
    previewByDiscussionIds(ids: readonly string[], max = 80): Map<string, string> {
      const out = new Map<string, string>();
      if (ids.length === 0) return out;
      const placeholders = ids.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT discussion_id, content FROM summaries WHERE discussion_id IN (${placeholders})`,
        )
        .all(...ids) as { discussion_id: string; content: string }[];
      for (const row of rows) {
        const chars = [...row.content.replace(/\s+/g, " ").trim()];
        out.set(
          row.discussion_id,
          chars.length <= max ? chars.join("") : `${chars.slice(0, max).join("")}…`,
        );
      }
      return out;
    },
  };
}

export type SummariesRepo = ReturnType<typeof createSummariesRepo>;
