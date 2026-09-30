import { z } from "zod";
import { ridePassportInput, rideAreaInput } from "./ride-plan.ts";
import { ridePlanOptions } from "./ride-plan-options.ts";
import {
  IntentError,
  intentLimits,
  validTimeZone,
  resolveLocal,
} from "./ride-intent-time.ts";
export { IntentError } from "./ride-intent-time.ts";
const timeZone = z
  .string()
  .refine(validTimeZone, "Укажите IANA-часовой пояс, например Europe/Moscow");
const windowInput = z
  .object({
    startLocal: z.string().max(16),
    endLocal: z.string().max(16),
    startFold: z.enum(["earlier", "later"]).optional(),
    endFold: z.enum(["earlier", "later"]).optional(),
  })
  .strict();
export const intentInput = z
  .object({
    readiness: z.enum(["ready", "considering"]),
    timeZone,
    windows: z.array(windowInput).min(1).max(intentLimits.windows),
    passport: ridePassportInput.extend({
      area: rideAreaInput,
      purpose: z.enum(Object.keys(ridePlanOptions.purpose)),
    }),
    meetNewPeople: z.boolean().optional(),
    visibility: z.enum(["private", "community"]).default("private"),
    allowSuggestions: z.boolean().default(false),
  })
  .strict();
export const createIntentInput = intentInput.extend({ requestId: z.uuid() });
export const intentPreferencesInput = z
  .object({
    passport: ridePassportInput,
    meetNewPeople: z.boolean().optional(),
  })
  .strict();
export function normalizeIntent(input: unknown, now = new Date()) {
  const parsed = intentInput.parse(input);
  const windows = parsed.windows
    .map((w) => ({
      startsAt: resolveLocal(w.startLocal, parsed.timeZone, w.startFold),
      endsAt: resolveLocal(w.endLocal, parsed.timeZone, w.endFold),
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const horizon = +now + intentLimits.horizonDays * 86400000;
  for (const [i, w] of windows.entries()) {
    const start = Date.parse(w.startsAt),
      end = Date.parse(w.endsAt);
    if (end <= start || end - start > intentLimits.windowHours * 3600000)
      throw new IntentError(
        "Окно доступности должно длиться от 1 минуты до 24 часов",
      );
    if (end <= +now || start < +now - 86400000 || end > horizon)
      throw new IntentError(
        "Выберите неистёкшее окно в пределах ближайших 90 дней",
      );
    if (i && windows[i - 1].endsAt > w.startsAt)
      throw new IntentError("Окна доступности не должны пересекаться");
    if (
      parsed.passport.durationMinutes?.min &&
      parsed.passport.durationMinutes.min >
        (end - Math.max(start, +now)) / 60000
    )
      throw new IntentError(
        "Минимальная длительность поездки не помещается в окно доступности",
      );
  }
  return { ...parsed, windows };
}
