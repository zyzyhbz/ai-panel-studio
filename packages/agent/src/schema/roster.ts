import { z } from "zod";
import { POLARITIES } from "@ai-panel/shared";
import { COLOR_KEYS } from "../core/types";

/**
 * P-ROSTER 的输出（与 AGENT-BEHAVIOR §8.1 对齐）。
 * strict：模型多给的字段会被判失败，避免"多塞字段"污染下游。
 */
export const rosterPersonaSchema = z
  .object({
    name: z.string().min(2).max(6),
    profession: z.string().min(1).max(12),
    title: z.string().min(1).max(16),
    stance: z.string().min(4).max(40),
    stanceAxis: z.string().min(2).max(16),
    polarity: z.enum(POLARITIES),
    focusArea: z.string().min(2).max(20),
    colorKey: z.enum(COLOR_KEYS),
  })
  .strict();

export const rosterOutputSchema = z
  .object({
    host: rosterPersonaSchema,
    experts: z.array(rosterPersonaSchema).min(3).max(6),
  })
  .strict();

export type RosterOutput = z.infer<typeof rosterOutputSchema>;
export type RosterPersonaOutput = z.infer<typeof rosterPersonaSchema>;
