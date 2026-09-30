import { z } from "zod";
import { uuid } from "./validation.ts";
export const textInput = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((s) => !s.includes("\0"));

export const commentInput = z
  .object({ body: textInput, parentId: uuid.nullable().optional() })
  .strict();
export const commentEdit = z.object({ body: textInput }).strict();

export const reportInput = z
  .object({
    entityType: z.enum([
      "comment",
      "profile",
      "bike",
      "ride",
      "ride_comment",
      "journal",
      "journal_comment",
      "component_comment",
      "component_photo",
    ]),
    targetId: uuid,
    reason: z.enum(["spam", "abuse", "inappropriate", "copyright", "other"]),
  })
  .strict();
export const reportAction = z
  .object({
    action: z.enum([
      "close",
      "delete_comment",
      "hide_ride",
      "hide_journal",
      "hide_component_photo",
    ]),
  })
  .strict();
export const communityPage = z.coerce.number().int().min(1).max(10000);
export class CommunityError extends Error {
  declare status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type CommentInput = z.infer<typeof commentInput>;
export type ReportInput = z.infer<typeof reportInput>;
