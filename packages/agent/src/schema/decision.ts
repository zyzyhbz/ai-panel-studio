import { z } from "zod";
import { INTENTS } from "@ai-panel/shared";
import { REASON_CODES } from "../core/types";

/**
 * P-DECIDE 的输出。
 * 注意：`reasonCode` 是内部字段（只进日志/eval），不属于公开事件。
 */
export const decisionOutputSchema = z
  .object({
    speakerId: z.string().min(1).max(64),
    intent: z.enum(INTENTS),
    turnFocus: z.string().min(2).max(20),
    targetMessageId: z.string().min(1).max(64).optional(),
    references: z.array(z.string().min(1).max(64)).min(1).max(4).optional(),
    action: z.enum(["next", "close"]).optional(),
    reasonCode: z.enum(REASON_CODES).optional(),
  })
  .strict();

export type DecisionOutput = z.infer<typeof decisionOutputSchema>;
