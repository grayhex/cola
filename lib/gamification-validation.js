import { z } from "zod";
import {
  achievements,
  recordDefinitions,
  defaultGamification,
  reactions,
} from "./gamification-definitions.js";
import { gameDescriptionLimit } from "./gamification-presentation.js";
const description = z.string().trim().max(gameDescriptionLimit);
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
    // Optional for older clients. The endpoint merges omitted maps with stored settings.
    recordImages: z.partialRecord(z.enum(recordDefinitions.map((r) => r.key)), z.uuid().nullable()).optional(),
    achievementImages: z.partialRecord(z.enum(achievements.map((a) => a.key)), z.uuid().nullable()).optional(),
    recordDescriptions: z.partialRecord(z.enum(recordDefinitions.map((r) => r.key)), description).optional(),
    achievementDescriptions: z.partialRecord(z.enum(achievements.map((a) => a.key)), description).optional(),
  })
  .strict()
  .refine((x) => x.weightMaximum > x.weightMinimum);
export const reactionKey = z.enum(Object.keys(reactions));
export const exclusionInput = z
  .object({ excluded: z.boolean(), reason: z.string().trim().min(3).max(300) })
  .strict();
export function gameSettings(raw) {
  return gameSettingsInput.parse({
    recordImages: {}, achievementImages: {},
    recordDescriptions: {}, achievementDescriptions: {},
    ...defaultGamification, ...raw,
  });
}
