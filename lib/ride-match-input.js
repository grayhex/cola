import { z } from "zod";
import { ridePlanOptions } from "./ride-plan-options.js";
import { uuid } from "./validation.ts";

// Query-string contract of /api/ride-matches (#232). Every field is optional
// unless stated; unknown parameters are rejected rather than ignored.
export const matchLimits = Object.freeze({
  horizonDays: 90,
  defaultRiderDays: 30,
  defaultSlotDays: 14,
  pageSize: 20,
  maxPages: 50,
  rideCandidates: 400,
  intentWindows: 4000,
  slots: 5,
  slotPeople: 20,
  // #234: the organizer workspace and invitations from interest.
  groups: 10,
  inviteBatch: 20,
  invitationsPerRide: 30,
});
const choice = (/** @type {keyof typeof ridePlanOptions} */ key) =>
  z.enum(Object.keys(ridePlanOptions[key])).optional();
const number = (/** @type {number} */ max, integer = false) =>
  (integer ? z.coerce.number().int().min(1) : z.coerce.number().positive())
    .max(max)
    .optional();
const instant = z.iso.datetime({ offset: true }).optional();
const common = {
  lng: z.coerce.number().min(-180).max(180).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  radiusKm: z.coerce.number().int().min(1).max(100).optional(),
  areaText: z.string().trim().min(1).max(100).optional(),
  pace: choice("pace"),
  purpose: choice("purpose"),
  surface: choice("surface"),
  difficulty: choice("difficulty"),
  durationMin: number(10080, true),
  durationMax: number(10080, true),
  distanceMin: number(1000),
  distanceMax: number(1000),
  page: z.coerce.number().int().min(1).max(matchLimits.maxPages).default(1),
};
const value = (/** @type {string|number} */ x) =>
  typeof x === "number" ? x : Date.parse(x);
/** @param {Record<string, any>} v @param {z.RefinementCtx} ctx */
function pairs(v, ctx) {
  const both = (/** @type {string} */ a, /** @type {string} */ b) => {
    if ((v[a] === undefined) !== (v[b] === undefined))
      ctx.addIssue({
        code: "custom",
        message: "Укажите обе границы диапазона",
        path: [a],
      });
    else if (v[a] !== undefined && value(v[a]) > value(v[b]))
      ctx.addIssue({
        code: "custom",
        message: "Нижняя граница не может быть больше верхней",
        path: [a],
      });
  };
  both("durationMin", "durationMax");
  both("distanceMin", "distanceMax");
  both("from", "to");
  const area = [v.lng, v.lat, v.radiusKm].filter((x) => x !== undefined);
  if (area.length % 3)
    ctx.addIssue({
      code: "custom",
      message: "Для области нужны долгота, широта и радиус",
      path: ["lng"],
    });
  if (area.length && v.areaText)
    ctx.addIssue({
      code: "custom",
      message: "Выберите либо область на карте, либо текст",
      path: ["areaText"],
    });
}
export const riderQuery = z
  .object({
    ...common,
    intent: uuid.optional(),
    from: instant,
    to: instant,
    strict: z.enum(["0", "1", "true", "false"]).optional(),
  })
  .strict()
  .superRefine(pairs);
export const draftQuery = z
  .object({ ...common, start: instant, from: instant, to: instant })
  .strict()
  .superRefine((v, ctx) => {
    pairs(v, ctx);
    if (v.start && v.from)
      ctx.addIssue({
        code: "custom",
        message: "Укажите либо время старта, либо период поиска",
        path: ["start"],
      });
    if (!v.start && v.durationMin === undefined)
      ctx.addIssue({
        code: "custom",
        message: "Для поиска общего времени укажите длительность",
        path: ["durationMin"],
      });
  });
export const planQuery = z
  .object({
    occurrenceAt: instant,
    page: common.page,
  })
  .strict();
/** «Собрать компанию» (#234): a period and a required duration; groups are
 * counts only, never names. */
export const groupsQuery = z
  .object({ ...common, from: instant, to: instant })
  .strict()
  .superRefine((v, ctx) => {
    pairs(v, ctx);
    if (v.durationMin === undefined)
      ctx.addIssue({
        code: "custom",
        message: "Укажите длительность поездки",
        path: ["durationMin"],
      });
  });
/** Explicit invitations of people whose intent fits one plan occurrence. */
export const interestInvitationsInput = z
  .object({
    occurrenceAt: z.iso.datetime({ offset: true }),
    userIds: z
      .array(uuid)
      .min(1, "Выберите, кого пригласить")
      .max(matchLimits.inviteBatch, "Слишком много приглашений за раз"),
  })
  .strict();
/** @param {URLSearchParams} params */
export function queryObject(params) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of params) {
    if (key in out)
      throw new z.ZodError([
        {
          code: "custom",
          message: "Параметр указан дважды",
          path: [key],
          input: value,
        },
      ]);
    out[key] = value;
  }
  return out;
}
/** Explicit request conditions → matcher passport + hard field list.
 * @param {z.infer<typeof riderQuery> | z.infer<typeof draftQuery>} v */
export function explicitConditions(v) {
  /** @type {import("./ride-match-core.js").Passport} */
  const passport = {};
  /** @type {string[]} */
  const hard = [];
  if (v.lng !== undefined && v.lat !== undefined && v.radiusKm !== undefined) {
    // The same coarse grid as stored areas: never keep more precision than 0.01°.
    passport.area = {
      label: "",
      center: [Math.round(v.lng * 100) / 100, Math.round(v.lat * 100) / 100],
      radiusM: v.radiusKm * 1000,
    };
    hard.push("area");
  }
  if (v.areaText) hard.push("area");
  for (const key of /** @type {const} */ ([
    "pace",
    "purpose",
    "surface",
    "difficulty",
  ]))
    if (v[key]) {
      passport[key] = v[key];
      hard.push(key);
    }
  if (v.durationMin !== undefined && v.durationMax !== undefined) {
    passport.durationMinutes = { min: v.durationMin, max: v.durationMax };
    hard.push("duration");
  }
  if (v.distanceMin !== undefined && v.distanceMax !== undefined) {
    passport.distanceKm = { min: v.distanceMin, max: v.distanceMax };
    hard.push("distance");
  }
  return { passport, hard, areaText: v.areaText };
}
