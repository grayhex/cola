import { z } from "zod";
export const bikeWeekSettingsInput = z.object({
  enabled: z.boolean().default(true),
  windowDays: z.number().int().min(1).max(90).default(7),
  minimumLikes: z.number().int().min(0).max(100000).default(1),
  minimumReactions: z.number().int().min(0).max(100000).default(0),
  minimumParticipants: z.number().int().min(0).max(100000).default(1),
  likeWeight: z.number().min(0).max(100).default(1),
  reactionWeight: z.number().min(0).max(100).default(2),
  discussionWeight: z.number().min(0).max(100).default(3),
  minimumScore: z.number().min(0).max(10000000).default(4),
  cooldownWeeks: z.number().int().min(0).max(104).default(12),
});
export type BikeWeekSettings = z.infer<typeof bikeWeekSettingsInput>;
export const bikeWeekStoryInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("publish"),
    text: z
      .string()
      .trim()
      .min(1)
      .max(600)
      .refine((s) => !s.includes("\0")),
  }),
  z.object({ action: z.literal("decline") }),
]);
// ISO calendar weeks, Monday 00:00 Europe/Moscow (UTC+03).
export function bikeWeekStart(now = new Date()) {
  const d = new Date(now.getTime() + 3 * 3600000);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export const weekInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const date = new Date(s + "T00:00:00Z");
    return (
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === s &&
      date.getUTCDay() === 1
    );
  }, "Укажите дату понедельника");
export const bikeWeekDecisionInput = z
  .object({
    week: weekInput,
    action: z.enum(["override", "skip", "automatic"]),
    bikeId: z.uuid().nullable().default(null),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((v) => v.action !== "override" || !!v.bikeId, {
    message: "Выберите велосипед",
  });
export const bikeWeekSearchInput = z.object({
  week: weekInput,
  q: z.string().trim().max(100).default(""),
});
