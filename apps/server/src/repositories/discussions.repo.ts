import type { DiscussionStatus } from "@ai-panel/shared";
import type { Db } from "../db/connection";
import type { DiscussionRecord } from "../types";

export interface CreateDiscussionInput {
  id: string;
  clientRequestId: string;
  topic: string;
  expertCount: number;
  plannedTurns: number;
  qaScenario: string | null;
  now: string;
}

export interface ListDiscussionsParams {
  statuses?: readonly DiscussionStatus[];
  archived?: "exclude" | "only" | "all";
  limit: number;
  offset: number;
}

interface DiscussionRow {
  id: string;
  client_request_id: string;
  topic: string;
  status: DiscussionStatus;
  expert_count: number;
  planned_turns: number;
  turn_count: number;
  last_seq: number;
  qa_scenario: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
  archived_at: string | null;
  error_code: string | null;
  error_message: string | null;
}

const COLUMNS = `id, client_request_id, topic, status, expert_count, planned_turns, turn_count,
  last_seq, qa_scenario, created_at, updated_at, started_at, ended_at, archived_at, error_code, error_message`;

export function mapDiscussion(row: DiscussionRow): DiscussionRecord {
  return {
    id: row.id,
    clientRequestId: row.client_request_id,
    topic: row.topic,
    status: row.status,
    expertCount: row.expert_count,
    plannedTurns: row.planned_turns,
    turnCount: row.turn_count,
    lastSeq: row.last_seq,
    qaScenario: row.qa_scenario,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    archivedAt: row.archived_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}

export interface StatusPatch {
  startedAt?: string | null;
  endedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export function createDiscussionsRepo(db: Db) {
  const insertStmt = db.prepare(
    `INSERT INTO discussions (
       id, client_request_id, topic, status, expert_count, planned_turns, turn_count,
       last_seq, qa_scenario, created_at, updated_at, started_at, ended_at, error_code, error_message
     ) VALUES (
       @id, @client_request_id, @topic, 'generating', @expert_count, @planned_turns, 0,
       0, @qa_scenario, @created_at, @created_at, NULL, NULL, NULL, NULL
     )`,
  );
  const getByIdStmt = db.prepare(`SELECT ${COLUMNS} FROM discussions WHERE id = ?`);
  const getByClientRequestIdStmt = db.prepare(
    `SELECT ${COLUMNS} FROM discussions WHERE client_request_id = ?`,
  );

  return {
    insert(input: CreateDiscussionInput): DiscussionRecord {
      insertStmt.run({
        id: input.id,
        client_request_id: input.clientRequestId,
        topic: input.topic,
        expert_count: input.expertCount,
        planned_turns: input.plannedTurns,
        qa_scenario: input.qaScenario,
        created_at: input.now,
      });
      const row = getByIdStmt.get(input.id) as DiscussionRow | undefined;
      if (!row) throw new Error("discussion insert failed");
      return mapDiscussion(row);
    },

    getById(id: string): DiscussionRecord | null {
      const row = getByIdStmt.get(id) as DiscussionRow | undefined;
      return row ? mapDiscussion(row) : null;
    },

    getByClientRequestId(clientRequestId: string): DiscussionRecord | null {
      const row = getByClientRequestIdStmt.get(clientRequestId) as
        | DiscussionRow
        | undefined;
      return row ? mapDiscussion(row) : null;
    },

    list(params: ListDiscussionsParams): { items: DiscussionRecord[]; total: number } {
      const where: string[] = [];
      const args: unknown[] = [];
      if (params.statuses && params.statuses.length > 0) {
        where.push(`status IN (${params.statuses.map(() => "?").join(",")})`);
        args.push(...params.statuses);
      }
      const archived = params.archived ?? "exclude";
      if (archived === "exclude") where.push("archived_at IS NULL");
      if (archived === "only") where.push("archived_at IS NOT NULL");
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const totalRow = db
        .prepare(`SELECT COUNT(*) AS c FROM discussions ${whereSql}`)
        .get(...args) as { c: number };
      const rows = db
        .prepare(
          `SELECT ${COLUMNS} FROM discussions ${whereSql}
           ORDER BY CASE WHEN status IN ('ended','failed') THEN 1 ELSE 0 END ASC,
                    updated_at DESC, id ASC
           LIMIT ? OFFSET ?`,
        )
        .all(...args, params.limit, params.offset) as DiscussionRow[];
      return { items: rows.map(mapDiscussion), total: totalRow.c };
    },

    archive(id: string, now: string, archived: boolean): DiscussionRecord | null {
      const info = db
        .prepare("UPDATE discussions SET archived_at = ?, updated_at = ? WHERE id = ?")
        .run(archived ? now : null, now, id);
      if (info.changes === 0) return null;
      return this.getById(id);
    },

    /**
     * Compare-and-set status transition. This is the ONLY way status changes.
     * Returns true when this caller won the transition (exactly one writer).
     */
    casStatus(
      id: string,
      from: readonly DiscussionStatus[],
      to: DiscussionStatus,
      now: string,
      patch: StatusPatch = {},
    ): boolean {
      const sets = ["status = ?", "updated_at = ?"];
      const values: unknown[] = [to, now];
      if (patch.startedAt !== undefined) {
        sets.push("started_at = ?");
        values.push(patch.startedAt);
      }
      if (patch.endedAt !== undefined) {
        sets.push("ended_at = ?");
        values.push(patch.endedAt);
      }
      if (patch.errorCode !== undefined) {
        sets.push("error_code = ?");
        values.push(patch.errorCode);
      }
      if (patch.errorMessage !== undefined) {
        sets.push("error_message = ?");
        values.push(patch.errorMessage);
      }
      const placeholders = from.map(() => "?").join(",");
      const info = db
        .prepare(
          `UPDATE discussions SET ${sets.join(", ")} WHERE id = ? AND status IN (${placeholders})`,
        )
        .run(...values, id, ...from);
      return info.changes === 1;
    },

    setLastSeq(id: string, seq: number): void {
      db.prepare("UPDATE discussions SET last_seq = ? WHERE id = ?").run(seq, id);
    },

    setTurnCount(id: string, turnCount: number, now: string): void {
      db.prepare("UPDATE discussions SET turn_count = ?, updated_at = ? WHERE id = ?").run(
        turnCount,
        now,
        id,
      );
    },

    touch(id: string, now: string): void {
      db.prepare("UPDATE discussions SET updated_at = ? WHERE id = ?").run(now, id);
    },

    /**
     * Boot recovery: non-stable states become `failed(INTERRUPTED)`.
     * Never re-runs the LLM (contract decision, docs/06 §1.3).
     *
     * `excludeIdPrefix` protects authored demo fixtures: a seeded `live` sample is
     * an intentional snapshot, not a crashed session.
     */
    markInterrupted(now: string, message: string, excludeIdPrefix?: string): string[] {
      return db.transaction(() => {
        const filter = excludeIdPrefix ? " AND id NOT LIKE ?" : "";
        const args = excludeIdPrefix ? [`${excludeIdPrefix}%`] : [];
        const rows = db
          .prepare(`SELECT id FROM discussions WHERE status IN ('live','summarizing')${filter}`)
          .all(...args) as { id: string }[];
        if (rows.length === 0) return [] as string[];
        const ids = rows.map((r) => r.id);
        const placeholders = ids.map(() => "?").join(",");
        db.prepare(
          `UPDATE discussions SET status = 'failed', error_code = 'INTERRUPTED',
             error_message = ?, updated_at = ?
           WHERE id IN (${placeholders})`,
        ).run(message, now, ...ids);
        return ids;
      })();
    },

    /** `generating` cannot resume either: no usable roster was persisted. */
    markStaleGenerating(now: string, message: string, excludeIdPrefix?: string): string[] {
      return db.transaction(() => {
        const filter = excludeIdPrefix ? " AND id NOT LIKE ?" : "";
        const args = excludeIdPrefix ? [`${excludeIdPrefix}%`] : [];
        const rows = db
          .prepare(`SELECT id FROM discussions WHERE status = 'generating'${filter}`)
          .all(...args) as { id: string }[];
        if (rows.length === 0) return [] as string[];
        const ids = rows.map((r) => r.id);
        const placeholders = ids.map(() => "?").join(",");
        db.prepare(
          `UPDATE discussions SET status = 'failed', error_code = 'INTERRUPTED',
             error_message = ?, updated_at = ?
           WHERE id IN (${placeholders})`,
        ).run(message, now, ...ids);
        return ids;
      })();
    },

    /** Self-heal the denormalized last_seq from the event log. */
    repairLastSeq(): number {
      const info = db
        .prepare(
          `UPDATE discussions
              SET last_seq = COALESCE((SELECT MAX(seq) FROM events e WHERE e.discussion_id = discussions.id), 0)
            WHERE last_seq <> COALESCE((SELECT MAX(seq) FROM events e WHERE e.discussion_id = discussions.id), 0)`,
        )
        .run();
      return info.changes;
    },

    countByStatus(): Record<string, number> {
      const rows = db
        .prepare("SELECT status, COUNT(*) AS c FROM discussions GROUP BY status")
        .all() as { status: string; c: number }[];
      const out: Record<string, number> = {};
      for (const row of rows) out[row.status] = row.c;
      return out;
    },

    exists(id: string): boolean {
      return Boolean(db.prepare("SELECT 1 FROM discussions WHERE id = ?").get(id));
    },
  };
}

export type DiscussionsRepo = ReturnType<typeof createDiscussionsRepo>;
