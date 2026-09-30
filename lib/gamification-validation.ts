import { z } from "zod";
import { defaultGamification, reactions } from "./gamification-definitions.ts";
// The rating's global thresholds. Awards and records themselves are rules
// (lib/game-rules.js).
export const gameSettingsInput = z
  .object({
    currency: z.literal("RUB"),
    reactionsEnabled: z.boolean(),
    minimumCompleteness: z.number().min(0).max(100),
    budgetMinimum: z.number().min(1).max(1e9),
    weightMinimum: z.number().min(1).max(100),
    weightMaximum: z.number().min(1).max(200),
  })
  .strict()
  .refine((x) => x.weightMaximum > x.weightMinimum);
export const reactionKey = z.enum(Object.keys(reactions));

export const exclusionInput = z
  .object({ excluded: z.boolean(), reason: z.string().trim().min(3).max(300) })
  .strict();
// Stored settings may still carry the maps of illustrations, descriptions
// and switched-off records from before the rules; they moved to game_rules.
export function gameSettings(raw: unknown) {
  const value = {
    ...defaultGamification,
    ...(raw !== null && typeof raw === "object" ? raw : {}),
  };
  return gameSettingsInput.parse(
    Object.fromEntries(
      Object.keys(defaultGamification).map((key) => [
        key,
        value[key as keyof typeof value],
      ]),
    ),
  );
}

export type ExclusionInput = z.infer<typeof exclusionInput>;
