import { z } from "zod";
import { ridePlanOptions } from "./ride-plan-options.js";
import { RideError } from "./ride-gpx.js";

const choice = (key) => z.enum(Object.keys(ridePlanOptions[key])).optional();
const range = (max, integer = false) => {
  const number = integer
    ? z.number().int().min(1).max(max)
    : z.number().positive().max(max);
  return z
    .object({ min: number, max: number })
    .strict()
    .refine(
      (v) => v.min <= v.max,
      "Нижняя граница не может быть больше верхней",
    );
};
// Coarse grid, never retain the submitted precise coordinates. A label alone is valid.
export const rideAreaInput = z
  .object({
    label: z.string().trim().min(1).max(100),
    center: z
      .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
      .transform((point) => point.map((n) => Math.round(Number(n) * 100) / 100))
      .optional(),
    radiusM: z.number().int().min(1000).max(100000).optional(),
  })
  .strict()
  .refine(
    (v) => !!v.center === (v.radiusM !== undefined),
    "Для области на карте нужны центр и радиус",
  );
export const ridePassportInput = z
  .object({
    area: rideAreaInput.optional(),
    purpose: choice("purpose"),
    pace: choice("pace"),
    surface: choice("surface"),
    difficulty: choice("difficulty"),
    distanceKm: range(1000).optional(),
    durationMinutes: range(10080, true).optional(),
    groupSize: range(100, true).optional(),
    speedKmh: range(60).optional(),
    beginnerFriendly: z.boolean().optional(),
    regroupPolicy: choice("regroupPolicy"),
  })
  .strict();
export const planFields = {
  passport: ridePassportInput.optional(),
  meetingVisibility: z.enum(["public", "participants"]).optional(),
  expectedEndAt: z.iso.datetime({ offset: true }).nullable().optional(),
};
/** @typedef {z.infer<typeof ridePassportInput>} RidePassport */
/** Validate the merged edit, including dates omitted by older clients.
 * @param {{passport?: RidePassport, scheduledAt?: string, expectedEndAt?: string|null, meetingVisibility?: string}} input
 * @param {{plan_passport?: RidePassport, started_at: string|Date, plan_ends_at?: string|Date|null, meeting_visibility?: string}|null} existing
 */
export function plannedDetails(input, existing = null) {
  const passport = ridePassportInput.parse(
    input.passport ?? existing?.plan_passport ?? {},
  );
  const start = new Date(
    input.scheduledAt ?? existing?.started_at ?? NaN,
  ).getTime();
  const end =
    input.expectedEndAt === undefined
      ? (existing?.plan_ends_at ?? null)
      : input.expectedEndAt;
  if (end !== null) {
    const minutes = (new Date(end).getTime() - start) / 60000;
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 10080)
      throw new RideError(
        "Окончание должно быть после старта, не позднее чем через 7 дней",
      );
    if (
      passport.durationMinutes &&
      (minutes < passport.durationMinutes.min ||
        minutes > passport.durationMinutes.max)
    )
      throw new RideError(
        "Окончание не соответствует общей длительности с остановками",
      );
  }
  return {
    passport,
    expectedEndAt: end,
    meetingVisibility:
      input.meetingVisibility ?? existing?.meeting_visibility ?? "participants",
  };
}
/** Shift the optional end with the particular weekly occurrence, not with an RSVP from last week. */
export function plannedEnd(r) {
  if (!r.plan_ends_at || !r.started_at) return null;
  return new Date(
    +new Date(r.occurs_at || r.started_at) +
      (+new Date(r.plan_ends_at) - +new Date(r.started_at)),
  ).toISOString();
}
