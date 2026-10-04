import type { Queryable } from "./db.ts";

// When an interrupting channel (e-mail now, push with #342) may carry a message
// to a person (#341). Pure decisions about time live here, so that e-mail, push
// and the tests ask the same question: a person's quiet hours and pause, read on
// their own clock. Who a message is for (the circle) and what is muted are SQL
// next to the code that fans events out and sends them; the inbox inside the
// site is not governed by any of this.

export const circleModes = ["friends", "follows", "selected", "off"] as const;
export type CircleMode = (typeof circleModes)[number];

/** A confirmed ride cancelled this close to its start may break the quiet, if the person chose that. */
export const nearCancellationMs = 12 * 3600_000;

export interface QuietHours {
  enabled: boolean;
  /** Minutes from local midnight; `from > to` wraps over midnight. */
  from: number;
  to: number;
  /** The explicit choice that a near, confirmed cancellation is not held back. */
  allowCancellations: boolean;
}
export interface DeliveryPolicy {
  /** The person's own IANA time zone; null until known. */
  timeZone: string | null;
  quiet: QuietHours;
  pausedUntil: Date | null;
}
export const defaultDeliveryPolicy: DeliveryPolicy = {
  timeZone: null,
  quiet: {
    enabled: false,
    from: 22 * 60,
    to: 7 * 60,
    allowCancellations: false,
  },
  pausedUntil: null,
};

// ---- Clock ----------------------------------------------------------------

const zoneName = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;
const formats = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formats.set(timeZone, format);
  }
  return format;
}

/**
 * The canonical name of an IANA time zone, or null when it is not one. A fixed
 * offset ("+03:00") is not a zone: it would be wrong half of the year.
 */
export function canonicalTimeZone(value: string): string | null {
  if (!zoneName.test(value)) return null;
  try {
    return formatter(value).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  /** Minutes since local midnight. */
  minutes: number;
  seconds: number;
}
function localParts(instant: Date, timeZone: string): LocalParts {
  const value: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant))
    if (part.type !== "literal") value[part.type] = Number(part.value);
  return {
    year: value.year,
    month: value.month,
    day: value.day,
    minutes: (value.hour % 24) * 60 + value.minute,
    seconds: value.second,
  };
}
/** The zone's offset from UTC at an instant, in minutes. */
function offsetMinutes(ms: number, timeZone: string) {
  const local = localParts(new Date(ms), timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    0,
    local.minutes,
    local.seconds,
  );
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}
/**
 * The instant at which a zone's wall clock shows a given day and time. When
 * the clock shows it twice (the hour that is repeated in autumn) the first
 * time counts; when it never shows it (the hour skipped in spring) the first
 * moment after the gap does.
 */
export function wallClockToInstant(
  day: { year: number; month: number; day: number },
  minutes: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(day.year, day.month - 1, day.day, 0, minutes);
  const offsets = [
    ...new Set([
      offsetMinutes(naive - 86400_000, timeZone),
      offsetMinutes(naive + 86400_000, timeZone),
    ]),
  ];
  const candidates = offsets.map((offset) => naive - offset * 60_000);
  const exact = candidates.filter(
    (ms) => offsetMinutes(ms, timeZone) * 60_000 === naive - ms,
  );
  return new Date(
    Math.min(...(exact.length ? exact : [Math.max(...candidates)])),
  );
}

/** Minutes from midnight of "HH:MM"; null when it is not a time of day. */
export function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
export function formatClock(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * The end of the quiet window that is open at `now`, or null when none is.
 * Read on the person's own clock, so it follows daylight saving time.
 */
export function quietEnd(policy: DeliveryPolicy, now: Date): Date | null {
  const { quiet, timeZone } = policy;
  if (!quiet.enabled || !timeZone || quiet.from === quiet.to) return null;
  const local = localParts(now, timeZone);
  const wraps = quiet.from > quiet.to;
  const inside = wraps
    ? local.minutes >= quiet.from || local.minutes < quiet.to
    : local.minutes >= quiet.from && local.minutes < quiet.to;
  if (!inside) return null;
  // The window ends on the next local `to`: today, unless it began yesterday evening.
  const next = wraps && local.minutes >= quiet.from ? 1 : 0;
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day + next));
  const end = wallClockToInstant(
    {
      year: day.getUTCFullYear(),
      month: day.getUTCMonth() + 1,
      day: day.getUTCDate(),
    },
    quiet.to,
    timeZone,
  );
  return end > now ? end : null;
}

// ---- Verdict --------------------------------------------------------------

export interface ExternalContext {
  /** The type of the notice (the catalogue's). */
  type: string;
  now: Date;
  /** After this the message is worth nothing: it is never sent. */
  expiresAt?: Date | null;
  /** The ride's date, for the cancellation exception. */
  occursAt?: Date | null;
  /** The person confirmed they are going on that date. */
  confirmed?: boolean;
}
export type ExternalVerdict =
  | { action: "deliver" }
  | { action: "defer"; until: Date }
  | { action: "drop"; reason: "expired" | "paused" | "quiet" };

/**
 * What an interrupting channel does with a message right now. A pause drops
 * (what was said during it is not caught up when it ends), a quiet window
 * defers to its end, a message that expires before that is dropped, never sent
 * in the morning for an evening that has passed.
 */
export function externalVerdict(
  policy: DeliveryPolicy,
  context: ExternalContext,
): ExternalVerdict {
  const { now, expiresAt } = context;
  if (expiresAt && expiresAt <= now)
    return { action: "drop", reason: "expired" };
  if (policy.pausedUntil && policy.pausedUntil > now)
    return { action: "drop", reason: "paused" };
  const end = quietEnd(policy, now);
  if (!end) return { action: "deliver" };
  const { occursAt } = context;
  if (
    context.type === "ride_cancelled" &&
    policy.quiet.allowCancellations &&
    context.confirmed &&
    occursAt &&
    occursAt > now &&
    occursAt.getTime() - now.getTime() <= nearCancellationMs
  )
    return { action: "deliver" };
  if (expiresAt && expiresAt <= end) return { action: "drop", reason: "quiet" };
  return { action: "defer", until: end };
}

interface PolicyRow {
  time_zone: string | null;
  quiet_enabled: boolean;
  quiet_from: number;
  quiet_to: number;
  quiet_cancel: boolean;
  paused_until: Date | null;
}
export function policyFromRow(row: PolicyRow | undefined): DeliveryPolicy {
  if (!row) return defaultDeliveryPolicy;
  return {
    timeZone: row.time_zone,
    quiet: {
      enabled: row.quiet_enabled,
      from: row.quiet_from,
      to: row.quiet_to,
      allowCancellations: row.quiet_cancel,
    },
    pausedUntil: row.paused_until ? new Date(row.paused_until) : null,
  };
}
export async function deliveryPolicy(
  q: Queryable,
  userId: string,
): Promise<DeliveryPolicy> {
  const { rows } = await q.query<PolicyRow>(
    "SELECT time_zone,quiet_enabled,quiet_from,quiet_to,quiet_cancel,paused_until FROM notification_settings WHERE user_id=$1",
    [userId],
  );
  return policyFromRow(rows[0]);
}

// ---- Mutes ----------------------------------------------------------------

export const muteKinds = ["author", "ride", "discussion"] as const;
export type MuteKind = (typeof muteKinds)[number];

/**
 * Whether the recipient of notice `n` has muted what it is about: its author,
 * its ride or, for a comment or a reply, the object that is discussed. Use
 * with the alias of `notifications`.
 */
export const noticeMutedSql = (alias = "n") =>
  `EXISTS(SELECT 1 FROM notification_mutes m WHERE m.user_id=${alias}.recipient_id AND (
    (m.kind='author' AND m.target_id=${alias}.actor_id)
    OR (m.kind='ride' AND m.target_id=${alias}.ride_id)
    OR (m.kind='discussion' AND ${alias}.comment_id IS NOT NULL AND m.target_id=${alias}.bike_id)
    OR (m.kind='discussion' AND ${alias}.ride_comment_id IS NOT NULL AND m.target_id=${alias}.ride_id)
    OR (m.kind='discussion' AND ${alias}.entry_comment_id IS NOT NULL AND m.target_id=${alias}.entry_id)
    OR (m.kind='discussion' AND ${alias}.component_comment_id IS NOT NULL AND m.target_id=${alias}.component_id)))`;
