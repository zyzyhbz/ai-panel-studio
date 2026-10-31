import type { InsightType } from "@ai-panel/shared";
import type { DiscussionSnapshot, InsightItem, TranscriptMessage } from "../core/types";
import type { InsightItemOutput } from "../schema/insight";
import {
  char3GramJaccard,
  extractNumbers,
  normalizeWhitespace,
  stableId,
  truncateChars,
} from "../core/text";

/**
 * 共识/分歧/待验证的判定与证据校验（AR-07）。
 *
 * 三道保险：
 * 1. 证据 id 白名单：不在本会话消息里的，整条丢弃（不改写、不补造）；
 * 2. 双人证据：consensus / divergence 必须来自 ≥2 位不同发言者；
 * 3. 数字溯源：content 里的数字必须能在证据原文里找到。
 */

export const INSIGHT_CAPS: Record<InsightType, number> = {
  consensus: 8,
  divergence: 6,
  open_question: 6,
};

export const MAX_NEW_INSIGHTS = 2;
export const DUPLICATE_SIMILARITY = 0.6;
export const INSIGHT_MAX_CHARS = 50;

export interface RejectedInsight {
  index: number;
  type?: string;
  reason: string;
}

export interface InsightNormalizeResult {
  insights: InsightItem[];
  rejected: RejectedInsight[];
  added: number;
  repaired: boolean;
}

export interface InsightNormalizeOptions {
  /** 当前轮次，用于给新条目写 firstSeenTurn */
  turnIndex?: number;
  maxNew?: number;
  /** 允许作为证据的消息 id 集合；默认用 snapshot.messages */
  knownMessageIds?: Set<string>;
}

export function normalizeInsights(
  raw: InsightItemOutput[] | undefined,
  snapshot: DiscussionSnapshot,
  options: InsightNormalizeOptions = {},
): InsightNormalizeResult {
  const known = options.knownMessageIds ?? new Set(snapshot.messages.map((m) => m.id));
  const messageById = new Map(snapshot.messages.map((m) => [m.id, m]));
  const existingById = new Map(snapshot.insights.map((i) => [i.id, i]));
  const turnIndex = options.turnIndex ?? Math.min(snapshot.turnCount + 1, snapshot.maxTurns);
  const maxNew = options.maxNew ?? MAX_NEW_INSIGHTS;

  const rejected: RejectedInsight[] = [];
  const accepted: InsightItem[] = [];
  let added = 0;
  let repaired = false;

  for (const [index, item] of (raw ?? []).entries()) {
    const content = normalizeWhitespace(item.content);
    if (content.length > INSIGHT_MAX_CHARS) {
      rejected.push({ index, type: item.type, reason: "content_too_long" });
      continue;
    }
    if (/我/u.test(content)) {
      rejected.push({ index, type: item.type, reason: "first_person" });
      continue;
    }

    const evidenceIds = [...new Set(item.evidenceMessageIds)].filter((id) => known.has(id));
    if (evidenceIds.length !== new Set(item.evidenceMessageIds).size) {
      rejected.push({ index, type: item.type, reason: "evidence_unknown" });
      continue;
    }
    if (evidenceIds.length === 0) {
      rejected.push({ index, type: item.type, reason: "evidence_empty" });
      continue;
    }

    const evidenceMessages = evidenceIds
      .map((id) => messageById.get(id))
      .filter((m): m is TranscriptMessage => m !== undefined);
    const speakers = new Set(evidenceMessages.map((m) => m.expertId));
    if ((item.type === "consensus" || item.type === "divergence") && speakers.size < 2) {
      rejected.push({ index, type: item.type, reason: "need_two_speakers" });
      continue;
    }

    const unsourced = extractNumbers(content).filter(
      (num) => !evidenceMessages.some((m) => m.content.includes(num)),
    );
    if (unsourced.length > 0) {
      rejected.push({ index, type: item.type, reason: `number_unsourced:${unsourced.join(",")}` });
      continue;
    }

    const matchedExisting = matchExisting(item, content, existingById, accepted);
    if (matchedExisting) {
      // 合并证据，保留原 id 与 firstSeenTurn，避免前端列表跳动
      const mergedEvidence = [...new Set([...matchedExisting.evidenceMessageIds, ...evidenceIds])];
      const mergedContent =
        content.length > matchedExisting.content.length ? content : matchedExisting.content;
      if (mergedEvidence.length !== matchedExisting.evidenceMessageIds.length) repaired = true;
      const target = accepted.find((i) => i.id === matchedExisting.id) ?? matchedExisting;
      target.content = mergedContent;
      target.evidenceMessageIds = mergedEvidence;
      if (!accepted.some((i) => i.id === target.id)) accepted.push(target);
      continue;
    }

    if (item.firstSeenTurn && item.firstSeenTurn < turnIndex) {
      // 模型回填历史轮次时，接受但标为修复
      repaired = true;
    }

    // 稳定 id：已存在条目沿用原 id（上面已合并返回）；新条目用内容哈希，
    // 保证同一主张在多次快照之间 id 不变，前端列表不会闪。
    const id = stableId("i", `${item.type}:${content}`);
    if (accepted.some((i) => i.id === id)) {
      rejected.push({ index, type: item.type, reason: "duplicate_id" });
      continue;
    }

    accepted.push({
      id,
      type: item.type,
      content,
      evidenceMessageIds: sortEvidence(evidenceMessages.map((m) => m.id), messageById),
      firstSeenTurn: Math.min(item.firstSeenTurn ?? turnIndex, turnIndex),
    });
    if (!existingById.has(id)) added += 1;
  }

  if (added > maxNew) {
    const kept: InsightItem[] = [];
    let newKept = 0;
    for (const item of accepted) {
      if (existingById.has(item.id)) {
        kept.push(item);
        continue;
      }
      if (newKept >= maxNew) {
        rejected.push({ index: -1, type: item.type, reason: "over_max_new" });
        continue;
      }
      newKept += 1;
      kept.push(item);
    }
    accepted.length = 0;
    accepted.push(...kept);
    repaired = true;
  }

  const capped = capByType(accepted, rejected);
  if (capped.length !== accepted.length) repaired = true;

  // 保留旧快照里模型本轮没提到的条目：全量快照语义下允许消失，但消失的是 active 结论时风险高；
  // 这里采取"信任模型 + 结构约束"：不自动回填，交由 backend/eval 观察（见 AGENT-BEHAVIOR §7.4）。
  return { insights: capped, rejected, added, repaired };
}

function matchExisting(
  item: InsightItemOutput,
  content: string,
  existingById: Map<string, InsightItem>,
  accepted: InsightItem[],
): InsightItem | undefined {
  if (item.id) {
    const direct = existingById.get(item.id);
    if (direct && direct.type === item.type) return direct;
  }
  const pool = [...existingById.values(), ...accepted];
  for (const candidate of pool) {
    if (candidate.type !== item.type) continue;
    if (char3GramJaccard(candidate.content, content) > DUPLICATE_SIMILARITY) return candidate;
  }
  return undefined;
}

function sortEvidence(ids: string[], messageById: Map<string, { turnIndex: number }>): string[] {
  return [...new Set(ids)].sort((a, b) => {
    const ta = messageById.get(a)?.turnIndex ?? 0;
    const tb = messageById.get(b)?.turnIndex ?? 0;
    return ta - tb;
  });
}

function capByType(
  items: InsightItem[],
  rejected: RejectedInsight[],
): InsightItem[] {
  const result: InsightItem[] = [];
  for (const type of ["consensus", "divergence", "open_question"] as InsightType[]) {
    const group = items
      .filter((i) => i.type === type)
      .sort((a, b) => {
        if (b.evidenceMessageIds.length !== a.evidenceMessageIds.length) {
          return b.evidenceMessageIds.length - a.evidenceMessageIds.length;
        }
        return a.firstSeenTurn - b.firstSeenTurn;
      });
    const cap = INSIGHT_CAPS[type];
    if (group.length > cap) {
      for (const extra of group.slice(cap)) {
        rejected.push({ index: -1, type, reason: `cap_${cap}` });
      }
    }
    result.push(...group.slice(0, cap));
  }
  return result;
}

/** 给 summary 使用的"一句话摘要"，防止总结引入新主张。 */
export function insightsForSummary(insights: InsightItem[]): string {
  if (insights.length === 0) return "（本场没有形成可靠的共识或分歧）";
  const label: Record<string, string> = {
    consensus: "共识",
    divergence: "分歧",
    open_question: "待验证",
  };
  return insights
    .map((i) => `- [${label[i.type]}] ${truncateChars(i.content, 50)}`)
    .join("\n");
}
