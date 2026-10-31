import { z } from "zod";

/**
 * 总结是纯文本三段，不是 JSON。
 * 这里校验的是"规范化之后的结果对象"，供 backend 落库前做最后一道门。
 */
export const summaryOutputSchema = z
  .object({
    content: z.string().min(20).max(400),
    paragraphs: z.array(z.string().min(1)).min(2).max(4),
    hasJsonLeak: z.boolean(),
  })
  .strict();

export type SummaryOutput = z.infer<typeof summaryOutputSchema>;
