import { z } from "zod";
import { AppError } from "./errors";
import { codePointLength, normalizePlainText } from "../lib/text";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const createDiscussionSchema = z.object({
  topic: z
    .string()
    .transform((v) => normalizePlainText(v))
    .refine((v) => codePointLength(v) >= 2, { message: "topic 至少 2 个字符" })
    .refine((v) => codePointLength(v) <= 200, { message: "topic 最多 200 个字符" }),
  expertCount: z.coerce.number().int().min(3).max(6).default(4),
  clientRequestId: z
    .string()
    .refine((v) => UUID_RE.test(v), { message: "clientRequestId 必须是 UUID v4" }),
});

export const listDiscussionsSchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const eventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export const streamQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
});

export const idParamSchema = z.object({ id: z.string().min(1).max(80) });

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      "VALIDATION_ERROR",
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
      { issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })) },
    );
  }
  return result.data;
}
