import { z } from "zod";
import { INSIGHT_TYPES } from "@ai-panel/shared";

/**
 * P-INSIGHT 的输出：全量快照。
 * 契约 v1.0 已删除 `status`（不做 resolved）与 `axis`（P1），此处不再输出。
 */
export const insightItemOutputSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    type: z.enum(INSIGHT_TYPES),
    content: z.string().min(4).max(50),
    evidenceMessageIds: z.array(z.string().min(1).max(64)).min(1).max(6),
    firstSeenTurn: z.number().int().min(1).max(30).optional(),
  })
  .strict();

export const insightOutputSchema = z
  .object({
    insights: z.array(insightItemOutputSchema).max(20),
  })
  .strict();

export type InsightOutput = z.infer<typeof insightOutputSchema>;
export type InsightItemOutput = z.infer<typeof insightItemOutputSchema>;
