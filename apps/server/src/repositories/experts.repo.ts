import type { ExpertRole, Polarity } from "@ai-panel/shared";
import type { Db } from "../db/connection";
import type { ExpertRecord } from "../types";

export interface ExpertInput {
  id: string;
  role: ExpertRole;
  name: string;
  profession: string;
  title: string;
  stance: string;
  stanceAxis: string;
  polarity: Polarity;
  focusArea: string;
  color: string;
  sortOrder: number;
}

interface ExpertRow {
  id: string;
  discussion_id: string;
  role: ExpertRole;
  name: string;
  profession: string;
  title: string;
  stance: string;
  stance_axis: string;
  polarity: Polarity;
  focus_area: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `id, discussion_id, role, name, profession, title, stance, stance_axis,
  polarity, focus_area, color, sort_order, created_at, updated_at`;

function map(row: ExpertRow): ExpertRecord {
  return {
    id: row.id,
    discussionId: row.discussion_id,
    role: row.role,
    name: row.name,
    profession: row.profession,
    title: row.title,
    stance: row.stance,
    stanceAxis: row.stance_axis,
    polarity: row.polarity,
    focusArea: row.focus_area,
    color: row.color,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createExpertsRepo(db: Db) {
  const listStmt = db.prepare(
    `SELECT ${COLUMNS} FROM experts WHERE discussion_id = ? ORDER BY sort_order ASC`,
  );
  const getOneStmt = db.prepare(
    `SELECT ${COLUMNS} FROM experts WHERE discussion_id = ? AND id = ?`,
  );
  const deleteStmt = db.prepare("DELETE FROM experts WHERE discussion_id = ?");
  const insertStmt = db.prepare(
    `INSERT INTO experts (${COLUMNS})
     VALUES (@id, @discussion_id, @role, @name, @profession, @title, @stance, @stance_axis,
             @polarity, @focus_area, @color, @sort_order, @created_at, @updated_at)`,
  );

  return {
    listByDiscussion(discussionId: string): ExpertRecord[] {
      return (listStmt.all(discussionId) as ExpertRow[]).map(map);
    },

    /** Batched load for the list endpoint (avoids N+1). Ordered by discussion then sort. */
    listByDiscussionIds(discussionIds: readonly string[]): Map<string, ExpertRecord[]> {
      const out = new Map<string, ExpertRecord[]>();
      if (discussionIds.length === 0) return out;
      const placeholders = discussionIds.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT ${COLUMNS} FROM experts WHERE discussion_id IN (${placeholders})
           ORDER BY discussion_id ASC, sort_order ASC`,
        )
        .all(...discussionIds) as ExpertRow[];
      for (const row of rows) {
        const list = out.get(row.discussion_id) ?? [];
        list.push(map(row));
        out.set(row.discussion_id, list);
      }
      return out;
    },

    getOne(discussionId: string, id: string): ExpertRecord | null {
      const row = getOneStmt.get(discussionId, id) as ExpertRow | undefined;
      return row ? map(row) : null;
    },

    countByDiscussion(discussionId: string): number {
      const row = db
        .prepare("SELECT COUNT(*) AS c FROM experts WHERE discussion_id = ?")
        .get(discussionId) as { c: number };
      return row.c;
    },

    /**
     * Replace the whole roster atomically.
     * Throws (FK RESTRICT) if any message already references the old experts —
     * that is the DB-level guarantee behind "cannot regenerate after speaking".
     */
    replaceAll(discussionId: string, experts: readonly ExpertInput[], now: string): ExpertRecord[] {
      const tx = db.transaction(() => {
        deleteStmt.run(discussionId);
        for (const expert of experts) {
          insertStmt.run({
            id: expert.id,
            discussion_id: discussionId,
            role: expert.role,
            name: expert.name,
            profession: expert.profession,
            title: expert.title,
            stance: expert.stance,
            stance_axis: expert.stanceAxis,
            polarity: expert.polarity,
            focus_area: expert.focusArea,
            color: expert.color,
            sort_order: expert.sortOrder,
            created_at: now,
            updated_at: now,
          });
        }
      });
      tx();
      return this.listByDiscussion(discussionId);
    },
  };
}

export type ExpertsRepo = ReturnType<typeof createExpertsRepo>;
