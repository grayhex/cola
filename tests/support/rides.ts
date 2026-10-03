import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Queryable } from "../../lib/db.ts";
import type {
  RideIntentRow,
  RideIntentWindowRow,
  RideInvitationRow,
  RideRow,
  RideRsvpRow,
} from "../../lib/database-rows.ts";
import type { intentInput } from "../../lib/ride-intent-input.ts";
import { given, insertRow, type Columns, instant } from "./rows.ts";

type Moment = Date | string | number;

/**
 * An intention with its windows ([start, end] pairs): active, ready, visible to
 * the community, with a passport that has an area. `overrides` are columns of
 * `ride_intents`.
 */
export async function intentRow(
  q: Queryable,
  ownerId: string,
  windows: readonly (readonly [Moment, Moment])[],
  overrides: Columns<RideIntentRow> = {},
): Promise<RideIntentRow> {
  const intent = await insertRow<RideIntentRow>(q, "ride_intents", {
    id: randomUUID(),
    owner_id: ownerId,
    readiness: "ready",
    time_zone: "Europe/Moscow",
    passport: { area: { label: "Парк", center: [37, 55] } },
    visibility: "community",
    request_hash: "hash",
    ...given(overrides),
  });
  for (const [start, end] of windows)
    await insertRow<RideIntentWindowRow>(q, "ride_intent_windows", {
      intent_id: intent.id,
      starts_at: instant(start),
      ends_at: instant(end),
    });
  return intent;
}

/**
 * A planned ride (no track yet) of `ownerId` on `bikeId`, starting at
 * `startsAt`: public, secret meeting point shown to participants only.
 * `overrides` are columns of `rides`.
 */
export async function planRow(
  q: Queryable,
  ownerId: string,
  bikeId: string,
  startsAt: Moment,
  overrides: Columns<RideRow> = {},
): Promise<RideRow> {
  const id = overrides.id ?? randomUUID();
  return insertRow<RideRow>(
    q,
    "rides",
    {
      id,
      share_id: id,
      owner_id: ownerId,
      bike_id: bikeId,
      title: "Plan",
      source_hash: "planned:" + id,
      status: "planned",
      source_kind: "planned",
      has_track: false,
      meeting_point: "Secret gate 7",
      started_at: instant(startsAt),
      is_public: true,
      distance_m: 0,
      point_count: 0,
      public_point_count: 0,
      public_geometry: [],
      privacy_radius_m: 500,
      meeting_visibility: "participants",
      ...given(overrides),
    },
    ["public_geometry"],
  );
}

export function rsvpRow(
  q: Queryable,
  rideId: string,
  userId: string,
  occursAt: Moment,
  response: RideRsvpRow["response"] = "accepted",
  overrides: Columns<RideRsvpRow> = {},
): Promise<RideRsvpRow> {
  return insertRow<RideRsvpRow>(q, "ride_rsvps", {
    ride_id: rideId,
    user_id: userId,
    occurs_at: instant(occursAt),
    response,
    ...given(overrides),
  });
}

export function invitationRow(
  q: Queryable,
  rideId: string,
  userId: string,
  overrides: Columns<RideInvitationRow> = {},
): Promise<RideInvitationRow> {
  return insertRow<RideInvitationRow>(q, "ride_invitations", {
    ride_id: rideId,
    user_id: userId,
    ...given(overrides),
  });
}

/** The body of a new ride intention as the API takes it (before validation). */
export type IntentDraft = z.input<typeof intentInput>;

/**
 * A valid draft for tomorrow-ish: one window on `date` (YYYY-MM-DD, tomorrow
 * by default), a park with an approximate center, `considering`, private.
 */
export function intentDraft(
  overrides: Partial<IntentDraft> = {},
  date = new Date(Date.now() + 86400000).toISOString().slice(0, 10),
): IntentDraft {
  return {
    readiness: "considering",
    timeZone: "Europe/Moscow",
    windows: [{ startLocal: date + "T10:00", endLocal: date + "T15:00" }],
    passport: {
      area: { label: "Парк", center: [37.123456, 55.654321], radiusM: 3000 },
      purpose: "social",
    },
    ...given(overrides),
  };
}

/** The columns of a ride a test sets; speed in m/s and gain in metres as numbers. */
export type RideOverrides = Columns<
  Omit<RideRow, "avg_speed_mps" | "elevation_gain_m">
> & { avg_speed_mps?: number | null; elevation_gain_m?: number | null };

/**
 * A completed ride of `ownerId` on `bikeId` that was imported from a track
 * file: public, two points, an approximate start. A plan is `planRow`.
 * `overrides` are columns of `rides`.
 */
export function rideRow(
  q: Queryable,
  ownerId: string,
  bikeId: string,
  overrides: RideOverrides = {},
): Promise<RideRow> {
  const id = overrides.id ?? randomUUID();
  const {
    avg_speed_mps: speed,
    elevation_gain_m: gain,
    ...columns
  } = overrides;
  return insertRow<RideRow>(
    q,
    "rides",
    {
      id,
      share_id: id,
      owner_id: ownerId,
      bike_id: bikeId,
      title: "Ride " + id.slice(0, 6),
      description: "описание",
      status: "completed",
      source_kind: "gpx",
      has_track: false,
      is_public: true,
      started_at: new Date(Date.now() - 48 * 3600000),
      distance_m: 12000,
      point_count: 2,
      public_point_count: 2,
      public_geometry: [],
      privacy_enabled: true,
      privacy_radius_m: 500,
      source_hash: "fixture-" + id,
      recurrence: "none",
      meeting_point: "",
      meeting_visibility: "public",
      plan_passport: {},
      import_metrics: {},
      avg_speed_mps:
        speed === undefined || speed === null ? speed : String(speed),
      elevation_gain_m:
        gain === undefined || gain === null ? gain : String(gain),
      ...given(columns),
    },
    ["public_geometry", "visible_metrics"],
  );
}
