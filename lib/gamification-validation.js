import { z } from "zod";
import {
  achievements,
  recordDefinitions,
  defaultGamification,
  reactions,
} from "./gamification-definitions.js";
export const gameSettingsInput = z
  .object({
    currency: z.literal("RUB"),
    enabledRecords: z
      .array(z.enum(recordDefinitions.map((r) => r.key)))
      .max(recordDefinitions.length)
      .refine((a) => new Set(a).size === a.length),
    reactionsEnabled: z.boolean(),
    minimumCompleteness: z.number().min(0).max(100),
    budgetMinimum: z.number().min(1).max(1e9),
    weightMinimum: z.number().min(1).max(100),
    weightMaximum: z.number().min(1).max(200),
    // Optional in requests from older clients; the save endpoint preserves
    // previously configured artwork when these fields are omitted.
    recordImages: z.partialRecord(z.enum(recordDefinitions.map((r) => r.key)), z.uuid().nullable()).optional(),
    achievementImages: z.partialRecord(z.enum(achievements.map((a) => a.key)), z.uuid().nullable()).optional(),
  })
  .strict()
  .refine((x) => x.weightMaximum > x.weightMinimum);
export const reactionKey = z.enum(Object.keys(reactions));
export const exclusionInput = z
  .object({ excluded: z.boolean(), reason: z.string().trim().min(3).max(300) })
  .strict();
export function gameSettings(raw) {
  return gameSettingsInput.parse({ recordImages: {}, achievementImages: {}, ...defaultGamification, ...raw });
}
