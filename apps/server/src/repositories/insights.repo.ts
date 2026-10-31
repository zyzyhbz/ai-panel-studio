import type { InsightType } from "@ai-panel/shared";
import type { Db } from "../db/connection";
import type { InsightRecord } from "../types";
import { collapseWhitespace, contentHash, normalizePlainText } from "../lib/text";

export interface InsightDraftInput {
  type: InsightType;
  content: string;
  evidenceMessageIds: readonly string[];
}

interface InsightRow {
  id: string;
  discussion_id: string;
  type: InsightType;
  content: string;
  content_hash: string;
  first_seen_turn: number;
  created_at: string;
  updated_at: string;
}

/** Defensive caps: the agent must respect these, the backend enforces them. */
export const INSIGHT_CAPS: Record<InsightType, number> = {
  consensus: 8,
  divergence: 6,
  open_question: 6,
};

function mapInsight(row: InsightRow, evidenceMessageIds: string[]): InsightRecord {
  return {
    id: row.id,
    discussionId: row.discussion_id,
    type: row.type,
    content: row.content,
    evidenceMessageIds,
    firstSeenTurn: row.first_seen_turn,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createInsightsRepo(db: Db) {
  const listStmt = db.prepare(
    `SELECT id, discussion_id, type, content, content_hash, first_seen_turn, created_at, updated_at
       FROM insights WHERE discussion_id = ? ORDER BY created_at ASC, id ASC`,
  );
  const evidenceStmt = db.prepare(
    `SELECT insight_id, message_id FROM insight_evidence
      WHERE insight_id IN (SELECT id FROM insights WHERE discussion_id = ?)
      ORDER BY message_id ASC`,
  );

  function evidenceMap(discussionId: string): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const row of evidenceStmt.all(discussionId) as {
      insight_id: string;
      message_id: string;
    }[]) {
      const list = out.get(row.insight_id) ?? [];
      list.push(row.message_id);
      out.set(row.insight_id, list);
    }
    return out;
  }

  return {
    listByDiscussion(discussionId: string): InsightRecord[] {
      const evidence = evidenceMap(discussionId);
      return (listStmt.all(discussionId) as InsightRow[]).map((row) =>
        mapInsight(row, evidence.get(row.id) ?? []),
      );
    },

    /**
     * Apply a full snapshot (contract: insight.updated is a full snapshot).
     *
     * Identity = (type, content_hash). Re-seeing the same content keeps the same id
     * and keeps updated_at untouched (docs/06 §1.7). Rows absent from the snapshot
     * are deleted, so the table always equals the latest snapshot.
     *
     * `validMessageIds` filters hallucinated evidence ids before they hit the FK.
     */
    replaceSnapshot(
      discussionId: string,
      drafts: readonly InsightDraftInput[],
      turnIndex: number,
      now: string,
      validMessageIds: ReadonlySet<string>,
    ): InsightRecord[] {
      const tx = db.transaction(() => {
        const existing = new Map<string, InsightRow>();
        for (const row of listStmt.all(discussionId) as InsightRow[]) {
          existing.set(`${row.type}:${row.content_hash}`, row);
        }

        const seenPerType: Record<string, number> = {};
        const keep = new Set<string>();
        const insertStmt = db.prepare(
          `INSERT INTO insights (id, discussion_id, type, content, content_hash,
             first_seen_turn, created_at, updated_at)
           VALUES (@id, @discussion_id, @type, @content, @content_hash,
             @first_seen_turn, @created_at, @updated_at)`,
        );
        const updateStmt = db.prepare(
          "UPDATE insights SET content = ?, updated_at = ? WHERE id = ?",
        );
        const delEvidenceStmt = db.prepare("DELETE FROM insight_evidence WHERE insight_id = ?");
        const insEvidenceStmt = db.prepare(
          "INSERT OR IGNORE INTO insight_evidence (insight_id, message_id) VALUES (?, ?)",
        );
        const currentEvidence = evidenceMap(discussionId);
        const idFactory = (): string =>
          `i_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

        for (const draft of drafts) {
          const type = draft.type;
          const content = normalizePlainText(draft.content);
          if (!content) continue;
          const cap = INSIGHT_CAPS[type] ?? 6;
          seenPerType[type] = (seenPerType[type] ?? 0) + 1;
          if (seenPerType[type] > cap) continue;

          const evidence = [...new Set(draft.evidenceMessageIds)]
            .filter((id) => validMessageIds.has(id))
            .sort();
          // No evidence -> cannot be consensus/divergence (contract AR-07).
          if (evidence.length === 0 && type !== "open_question") continue;

          const hash = contentHash(type, content);
          const key = `${type}:${hash}`;
          const hit = existing.get(key);

          if (hit) {
            keep.add(hit.id);
            const prev = currentEvidence.get(hit.id) ?? [];
            const changed =
              prev.length !== evidence.length || prev.some((id, i) => id !== evidence[i]);
            if (changed) {
              delEvidenceStmt.run(hit.id);
              for (const messageId of evidence) insEvidenceStmt.run(hit.id, messageId);
              updateStmt.run(content, now, hit.id);
            } else {
              // Content unchanged: keep original updated_at (docs/06 §1.7).
              if (collapseWhitespace(hit.content) !== collapseWhitespace(content)) {
                updateStmt.run(content, now, hit.id);
              }
            }
            continue;
          }

          const id = idFactory();
          insertStmt.run({
            id,
            discussion_id: discussionId,
            type,
            content,
            content_hash: hash,
            first_seen_turn: turnIndex,
            created_at: now,
            updated_at: now,
          });
          for (const messageId of evidence) insEvidenceStmt.run(id, messageId);
          keep.add(id);
        }

        const delInsightStmt = db.prepare("DELETE FROM insights WHERE id = ?");
        for (const [key, row] of existing) {
          if (keep.has(row.id)) continue;
          const stillPresent = drafts.some(
            (d) => `${d.type}:${contentHash(d.type, normalizePlainText(d.content))}` === key,
          );
          if (!stillPresent) delInsightStmt.run(row.id);
        }
      });
      tx();
      return this.listByDiscussion(discussionId);
    },

    countByDiscussion(discussionId: string): number {
      const row = db
        .prepare("SELECT COUNT(*) AS c FROM insights WHERE discussion_id = ?")
        .get(discussionId) as { c: number };
      return row.c;
    },
  };
}

export type InsightsRepo = ReturnType<typeof createInsightsRepo>;
