import { z } from "zod";
import type { Queryable } from "./db.ts";
import { notificationLimits } from "./notification-fanout.ts";
import { ridePlanOptions } from "./ride-plan-options.ts";

// The private area of "rides near me" (#343). It is the answer to "which part of
// town do you ride in", given on purpose: chosen by hand, or a coarse cell the
// phone confirmed. It is not a profile field and not a published intention, and
// turning it on is a consent of its own (the others: publishing an intention,
// receiving suggestions, allowing push). One row per account holds the last area
// only: no history of places, no raw measurements, no precise address.
//
// What the server keeps is the centre of a grid cell. A phone must send the cell
// itself (the server refuses a finer point: rounding on the server does not
// replace not sending the place); a hand-picked area is snapped on arrival
// because the person named a district, not where they stand.

/** A cell is 0.03° of latitude (about 3.3 km) by 0.05° of longitude (about 1.9 to 3.2 km in Russia). */
export const nearbyGrid = Object.freeze({ latStep: 0.03, lngStep: 0.05 });
export const nearbyLimits = Object.freeze({
  minRadiusM: 5000,
  radiusStepM: 1000,
  horizonDays: Object.freeze({ min: 1, max: 30, default: 14 }),
});
const decimals = 5;
const round = (value: number) => Number(value.toFixed(decimals));

export class NearbyError extends Error {
  declare status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** The centre of the grid cell a point is in: the only place that is kept. */
export function snapToCell(lng: number, lat: number): [number, number] {
  const cell = (value: number, step: number) =>
    round((Math.floor(value / step + 1e-9) + 0.5) * step);
  return [cell(lng, nearbyGrid.lngStep), cell(lat, nearbyGrid.latStep)];
}
/** Whether a point is a cell centre, as a phone must send it. */
export function isCellCenter(lng: number, lat: number) {
  const [cellLng, cellLat] = snapToCell(lng, lat);
  return Math.abs(cellLng - lng) < 1e-6 && Math.abs(cellLat - lat) < 1e-6;
}

const optionKeys = (key: keyof typeof ridePlanOptions) =>
  Object.keys(ridePlanOptions[key]) as [string, ...string[]];
const choices = (key: keyof typeof ridePlanOptions) =>
  z
    .array(z.enum(optionKeys(key)))
    .max(optionKeys(key).length)
    .refine((items) => new Set(items).size === items.length, {
      message: "Значение указано дважды",
    });
/** What kinds of rides to suggest; an empty list means any. */
export const nearbyFilters = z.strictObject({
  purposes: choices("purpose"),
  paces: choices("pace"),
  surfaces: choices("surface"),
});
export type NearbyFilters = z.infer<typeof nearbyFilters>;
const emptyFilters: NearbyFilters = { purposes: [], paces: [], surfaces: [] };

export const nearbyAreaInput = z.strictObject({
  source: z.enum(["manual", "device"]),
  /** [longitude, latitude]: a cell centre from a phone, any point of the district by hand. */
  center: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  radiusM: z.int().min(nearbyLimits.minRadiusM).max(100_000),
  /** The name of a hand-picked district; a phone's area has none. */
  label: z.string().trim().min(1).max(100).nullable().optional(),
  /** The owner's explicit choice to replace an area that came from the other source. */
  replaceSource: z.boolean().optional(),
});
export type NearbyAreaInput = z.infer<typeof nearbyAreaInput>;

export const nearbySettingsPatch = z
  .strictObject({
    enabled: z.boolean().optional(),
    horizonDays: z
      .int()
      .min(nearbyLimits.horizonDays.min)
      .max(nearbyLimits.horizonDays.max)
      .optional(),
    filters: nearbyFilters.partial().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Укажите, что изменить",
  });
export type NearbySettingsPatch = z.infer<typeof nearbySettingsPatch>;

interface NearbyRow {
  user_id: string;
  enabled: boolean;
  source: "manual" | "device" | null;
  label: string | null;
  area_lng: string | null;
  area_lat: string | null;
  radius_m: number | null;
  observed_at: Date | null;
  expires_at: Date | null;
  horizon_days: number;
  filters: unknown;
  version: string;
}
export interface NearbyState {
  /** The operator's switch: false means nothing below is read or kept. */
  available: boolean;
  enabled: boolean;
  source: "manual" | "device" | null;
  area: {
    label: string | null;
    center: [number, number];
    radiusM: number;
  } | null;
  observedAt: Date | null;
  expiresAt: Date | null;
  /** A phone's area whose term has passed: kept for nothing, used for nothing. */
  expired: boolean;
  horizonDays: number;
  filters: NearbyFilters;
  /** The text of `updated_at` ("none" before any row): the version of a change. */
  version: string;
  limits: {
    minRadiusM: number;
    maxRadiusM: number;
    radiusStepM: number;
    deviceTtlHours: number;
    cell: { latStep: number; lngStep: number };
  };
}

const columns = `user_id,enabled,source,label,area_lng,area_lat,radius_m,observed_at,expires_at,horizon_days,filters,updated_at::text AS version`;

function stateOf(
  row: NearbyRow | undefined,
  limits: Awaited<ReturnType<typeof notificationLimits>>,
  now: Date,
): NearbyState {
  const filters = nearbyFilters.safeParse({
    ...emptyFilters,
    ...((row?.filters as object | undefined) ?? {}),
  });
  const expired =
    !!row?.expires_at && new Date(row.expires_at).getTime() <= now.getTime();
  return {
    available: limits.nearbyEnabled,
    enabled: row?.enabled ?? false,
    source: row?.source ?? null,
    area:
      row?.area_lng != null && row.area_lat != null && row.radius_m != null
        ? {
            label: row.label,
            center: [Number(row.area_lng), Number(row.area_lat)],
            radiusM: row.radius_m,
          }
        : null,
    observedAt: row?.observed_at ?? null,
    expiresAt: row?.expires_at ?? null,
    expired,
    horizonDays: row?.horizon_days ?? nearbyLimits.horizonDays.default,
    filters: filters.success ? filters.data : emptyFilters,
    version: row?.version ?? "none",
    limits: {
      minRadiusM: nearbyLimits.minRadiusM,
      maxRadiusM: limits.nearbyMaxRadiusKm * 1000,
      radiusStepM: nearbyLimits.radiusStepM,
      deviceTtlHours: limits.nearbyDeviceTtlHours,
      cell: { latStep: nearbyGrid.latStep, lngStep: nearbyGrid.lngStep },
    },
  };
}

/** The person's area and settings as they are, read once. */
export async function nearbyState(
  q: Queryable,
  userId: string,
  now = new Date(),
): Promise<NearbyState> {
  const row = (
    await q.query<NearbyRow>(
      `SELECT ${columns} FROM nearby_areas WHERE user_id=$1`,
      [userId],
    )
  ).rows[0];
  return stateOf(row, await notificationLimits(q), now);
}

/**
 * Takes the person's row under lock (creating nothing yet) and lets the caller
 * refuse the version they read. One user, one row, one writer at a time: two
 * devices meet here, the second finds the first one's version.
 */
async function lockRow(
  q: Queryable,
  userId: string,
  precondition?: (version: string) => void,
) {
  const user = await q.query(
    "SELECT 1 FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
    [userId],
  );
  if (!user.rowCount) throw new NearbyError("Войдите в аккаунт", 401);
  const row = (
    await q.query<NearbyRow>(
      `SELECT ${columns} FROM nearby_areas WHERE user_id=$1`,
      [userId],
    )
  ).rows[0];
  precondition?.(row?.version ?? "none");
  return row;
}

const unavailable = () =>
  new NearbyError("Поиск поездок рядом сейчас отключён", 503);

/**
 * Saves the one area. `precondition` sees the version being replaced (a stale
 * writer is refused there). A phone's area is accepted only as a cell centre and
 * only while the active source is the phone's or none; to put a phone's area
 * over a hand-picked one (or the other way round) the owner says
 * `replaceSource`. Saving an area never turns the feature on.
 */
export async function saveNearbyArea(
  q: Queryable,
  userId: string,
  input: unknown,
  {
    now = new Date(),
    precondition,
  }: { now?: Date; precondition?: (version: string) => void } = {},
) {
  const area = nearbyAreaInput.parse(input);
  const limits = await notificationLimits(q);
  if (!limits.nearbyEnabled) throw unavailable();
  if (
    area.radiusM > limits.nearbyMaxRadiusKm * 1000 ||
    area.radiusM % nearbyLimits.radiusStepM !== 0
  )
    throw new NearbyError(
      `Радиус — от 5 до ${limits.nearbyMaxRadiusKm} км, кратно километру`,
    );
  const [lng, lat] = area.center;
  if (area.source === "device") {
    if (!isCellCenter(lng, lat))
      throw new NearbyError(
        "Положение с телефона передаётся только грубо: центром ячейки сетки. Точную точку не отправляйте.",
      );
    if (area.label) throw new NearbyError("У района с телефона нет названия");
  }
  const existing = await lockRow(q, userId, precondition);
  if (
    existing?.source &&
    existing.source !== area.source &&
    !area.replaceSource
  )
    throw new NearbyError(
      existing.source === "manual"
        ? "Сейчас действует район, выбранный вручную. Чтобы заменить его положением с телефона, подтвердите замену."
        : "Сейчас действует район с телефона. Чтобы заменить его выбранным вручную, подтвердите замену.",
      409,
    );
  const [cellLng, cellLat] = snapToCell(lng, lat);
  const expires =
    area.source === "device"
      ? new Date(now.getTime() + limits.nearbyDeviceTtlHours * 3600_000)
      : null;
  await q.query(
    `INSERT INTO nearby_areas(user_id,source,label,area_lng,area_lat,radius_m,observed_at,expires_at,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
     ON CONFLICT(user_id) DO UPDATE SET source=$2,label=$3,area_lng=$4,area_lat=$5,radius_m=$6,observed_at=$7,expires_at=$8,updated_at=now()`,
    [
      userId,
      area.source,
      area.source === "manual" ? (area.label ?? null) : null,
      cellLng,
      cellLat,
      area.radiusM,
      now,
      expires,
    ],
  );
  return nearbyState(q, userId, now);
}

/** Turns the feature on or off and sets how far ahead and what kind; only what is given changes. */
export async function saveNearbySettings(
  q: Queryable,
  userId: string,
  input: unknown,
  {
    now = new Date(),
    precondition,
  }: { now?: Date; precondition?: (version: string) => void } = {},
) {
  const patch = nearbySettingsPatch.parse(input);
  const limits = await notificationLimits(q);
  // Turning it off is always possible; turning it on needs the operator's switch.
  if (patch.enabled === true && !limits.nearbyEnabled) throw unavailable();
  const existing = await lockRow(q, userId, precondition);
  const filters = nearbyFilters.parse({
    ...emptyFilters,
    ...((existing?.filters as object | undefined) ?? {}),
    ...(patch.filters ?? {}),
  });
  await q.query(
    `INSERT INTO nearby_areas(user_id,enabled,horizon_days,filters,created_at,updated_at)
     VALUES($1,$2,$3,$4::jsonb,now(),now())
     ON CONFLICT(user_id) DO UPDATE SET enabled=$2,horizon_days=$3,filters=$4::jsonb,updated_at=now()`,
    [
      userId,
      patch.enabled ?? existing?.enabled ?? false,
      patch.horizonDays ??
        existing?.horizon_days ??
        nearbyLimits.horizonDays.default,
      JSON.stringify(filters),
    ],
  );
  return nearbyState(q, userId, now);
}

/** Removes the area and nothing else: the switch and the preferences stay. */
export async function removeNearbyArea(
  q: Queryable,
  userId: string,
  {
    now = new Date(),
    precondition,
  }: { now?: Date; precondition?: (version: string) => void } = {},
) {
  const existing = await lockRow(q, userId, precondition);
  if (existing?.area_lng != null)
    await q.query(
      `UPDATE nearby_areas SET source=NULL,label=NULL,area_lng=NULL,area_lat=NULL,radius_m=NULL,observed_at=NULL,expires_at=NULL,updated_at=now() WHERE user_id=$1`,
      [userId],
    );
  return nearbyState(q, userId, now);
}

/** Opt-out: the area, the switch and the preferences, all of it. Repeating it is fine. */
export async function forgetNearby(q: Queryable, userId: string) {
  await lockRow(q, userId);
  await q.query("DELETE FROM nearby_areas WHERE user_id=$1", [userId]);
}

/**
 * Removes the areas whose term has passed. A phone's area is kept for its term
 * and not a minute longer; nothing but the phone confirming a new one extends it.
 * The row stays (the switch and the preferences are the person's), the place goes.
 */
export async function pruneNearbyAreas(q: Queryable, now = new Date()) {
  const { rowCount } = await q.query(
    `UPDATE nearby_areas SET source=NULL,label=NULL,area_lng=NULL,area_lat=NULL,radius_m=NULL,observed_at=NULL,expires_at=NULL,updated_at=now()
     WHERE expires_at IS NOT NULL AND expires_at<=$1::timestamptz`,
    [now],
  );
  return rowCount ?? 0;
}
