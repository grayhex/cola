import type { Queryable } from "./db.ts";
import { mailEnabled } from "./mail.ts";
import { notificationEmailEnqueueSql } from "./notification-catalog.ts";
import { rideOccurrence } from "./ride-occurrence.ts";
import { rideNoticeVisible } from "./ride-notification-policy.ts";

type RideEvent =
  "ride_invite" | "ride_changed" | "ride_cancelled" | "ride_response";
const key = (
  type: string,
  ride: string,
  occurrence: string,
  revision: string,
) =>
  `'${type}:'||${ride}||':'||floor(extract(epoch FROM ${occurrence})*1000)::bigint||':'||${revision}`;

export async function rideNotice(
  q: Queryable,
  ride: string,
  type: RideEvent,
  {
    recipients,
    occursAt,
  }: { recipients?: string[]; occursAt?: string | Date | null } = {},
) {
  await q.query(
    `WITH plan AS (SELECT r.id,r.owner_id,r.agreement_revision,coalesce($3::timestamptz,(${rideOccurrence})) occurs_at FROM rides r WHERE r.id=$1),
    recipients AS (SELECT i.user_id FROM ride_invitations i WHERE i.ride_id=$1
      UNION SELECT v.user_id FROM ride_rsvps v,plan p WHERE v.ride_id=p.id AND v.occurs_at=p.occurs_at AND v.response IN ('accepted','maybe')),
    created AS (INSERT INTO notifications(id,recipient_id,actor_id,type,ride_id,dedup_key,event_occurs_at,event_revision)
      SELECT gen_random_uuid(),u.id,CASE WHEN $2='ride_response' THEN NULL ELSE p.owner_id END,$2,p.id,
        $2||':'||p.id||':'||floor(extract(epoch FROM p.occurs_at)*1000)::bigint||':'||p.agreement_revision||CASE WHEN $2='ride_response' THEN ':'||floor(extract(epoch FROM now())/900)::bigint ELSE '' END,p.occurs_at,p.agreement_revision
      FROM plan p JOIN users u ON NOT u.blocked
      WHERE p.occurs_at IS NOT NULL AND (CASE WHEN $4::uuid[] IS NOT NULL THEN u.id=ANY($4::uuid[]) ELSE u.id IN (SELECT user_id FROM recipients) END)
        AND ($2='ride_response' OR u.id<>p.owner_id)
        AND ($2='ride_response' OR NOT EXISTS(SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id=u.id AND ub.blocked_id=p.owner_id) OR (ub.blocker_id=p.owner_id AND ub.blocked_id=u.id)))
      ON CONFLICT(recipient_id,dedup_key) DO NOTHING RETURNING id,recipient_id,type)
    ${notificationEmailEnqueueSql("$5::boolean", { available: type === "ride_response" ? "now()+interval '5 minutes'" : "now()" })}`,
    [ride, type, occursAt || null, recipients || null, mailEnabled()],
  );
}

/** Revocation/revision/cancellation permanently fences old pending deliveries. */
export async function invalidateRideNotices(
  q: Queryable,
  ride: string,
  {
    recipients,
    occursAt,
    remindersOnly = false,
  }: {
    recipients?: string[];
    occursAt?: string | Date;
    remindersOnly?: boolean;
  } = {},
) {
  await q.query(
    `WITH cancelled AS (UPDATE notifications SET cancelled_at=now()
    WHERE ride_id=$1 AND type=ANY($4::text[]) AND cancelled_at IS NULL AND event_occurs_at>now()
      AND ($2::uuid[] IS NULL OR recipient_id=ANY($2::uuid[])) AND ($3::timestamptz IS NULL OR event_occurs_at=$3)
    RETURNING id)
    UPDATE notification_email_outbox o SET status='skipped',error_code='unavailable',finished_at=now(),lease_token=NULL,lease_until=NULL
    FROM cancelled n WHERE o.notification_id=n.id AND o.status IN ('pending','sending')`,
    [
      ride,
      recipients || null,
      occursAt || null,
      remindersOnly
        ? ["ride_reminder"]
        : ["ride_invite", "ride_changed", "ride_response", "ride_reminder"],
    ],
  );
}

/** Durable schedule from current confirmations, including pre-upgrade RSVP.
 * One per occurrence/revision, 24h ahead; late join or recovery only with >5m left. */
export async function scheduleRideReminders(
  q: Queryable,
  now = new Date(),
  { ride, user }: { ride?: string; user?: string } = {},
) {
  const occurrence = rideOccurrence.replaceAll("now()", "($1::timestamptz)");
  // Acquire FK parent locks without waiting before inserting a notice. RSVP
  // edits hold users/rides before notifications; the opposite order deadlocks.
  await q.query(
    `WITH eligible AS (SELECT v.ride_id,v.user_id,v.occurs_at,v.revision FROM ride_rsvps v JOIN rides r ON r.id=v.ride_id JOIN users u ON u.id=v.user_id JOIN users owner ON owner.id=r.owner_id JOIN bikes b ON b.id=r.bike_id
      LEFT JOIN notification_settings p ON p.user_id=v.user_id
      WHERE v.response='accepted' AND v.revision=r.agreement_revision AND r.status='planned' AND NOT u.blocked AND NOT owner.blocked
        AND ($2::uuid IS NULL OR v.ride_id=$2) AND ($3::uuid IS NULL OR v.user_id=$3)
        AND coalesce(p.reminders,true) AND v.occurs_at>$1::timestamptz+interval '5 minutes' AND v.occurs_at=(${occurrence})
        AND ((r.is_public AND b.is_public) OR EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=v.user_id))
        AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.recipient_id=v.user_id AND n.dedup_key=${key("ride_reminder", "v.ride_id", "v.occurs_at", "v.revision")} AND (n.cancelled_at IS NULL OR n.released_at IS NOT NULL))
      ORDER BY v.occurs_at,v.ride_id,v.user_id LIMIT 100 FOR KEY SHARE OF u,r SKIP LOCKED)
    INSERT INTO notifications(id,recipient_id,actor_id,type,ride_id,dedup_key,event_occurs_at,event_revision,deliver_after,created_at)
    SELECT gen_random_uuid(),user_id,NULL,'ride_reminder',ride_id,${key("ride_reminder", "ride_id", "occurs_at", "revision")},occurs_at,revision,greatest($1::timestamptz,occurs_at-interval '24 hours'),greatest($1::timestamptz,occurs_at-interval '24 hours') FROM eligible
    ON CONFLICT(recipient_id,dedup_key) DO UPDATE SET cancelled_at=NULL
      WHERE notifications.released_at IS NULL`,
    [now, ride || null, user || null],
  );
}
export async function releaseRideReminders(
  q: Queryable,
  now = new Date(),
  emailEnabled = mailEnabled(),
) {
  await scheduleRideReminders(q, now);
  // Include the recipient's nonblocking FK lock before queue insertion too.
  await q.query(
    `WITH due AS (SELECT n.id FROM notifications n JOIN users recipient ON recipient.id=n.recipient_id AND NOT recipient.blocked JOIN rides r ON r.id=n.ride_id JOIN bikes rb ON rb.id=r.bike_id JOIN users ro ON ro.id=r.owner_id
      WHERE n.type='ride_reminder' AND n.released_at IS NULL AND ${rideNoticeVisible("$1::timestamptz")}
      ORDER BY n.deliver_after,n.id LIMIT 100 FOR UPDATE OF n SKIP LOCKED FOR KEY SHARE OF recipient SKIP LOCKED),
    created AS (UPDATE notifications n SET released_at=$1 FROM due WHERE n.id=due.id RETURNING n.id,n.recipient_id,n.type,n.event_occurs_at)
    ${notificationEmailEnqueueSql("$2::boolean", { available: "$1::timestamptz", expires: "event_occurs_at-interval '5 minutes'" })}`,
    [now, emailEnabled],
  );
}
export async function rideReminderStatus(
  q: Queryable,
  ride: string,
  user: string,
  now = new Date(),
) {
  const row = (
    await q.query<{
      at: Date | null;
      enabled: boolean;
      email_enabled: boolean;
      released: boolean;
    }>(
      `SELECT coalesce(s.reminders,true) enabled,coalesce(p.enabled AND p.rides AND u.email_verified_at IS NOT NULL,false) email_enabled,n.deliver_after at,(n.released_at IS NOT NULL) released
    FROM users u LEFT JOIN notification_email_preferences p ON p.user_id=u.id LEFT JOIN notification_settings s ON s.user_id=u.id
    LEFT JOIN notifications n ON n.recipient_id=u.id AND n.ride_id=$2 AND n.type='ride_reminder' AND n.cancelled_at IS NULL AND n.event_occurs_at>$3 AND n.event_revision=(SELECT agreement_revision FROM rides WHERE id=$2)
    WHERE u.id=$1 AND NOT u.blocked ORDER BY n.event_occurs_at LIMIT 1`,
      [user, ride, now],
    )
  ).rows[0];
  return row
    ? {
        enabled: row.enabled,
        emailEnabled: row.email_enabled && mailEnabled(),
        at: row.at?.toISOString() || null,
        released: row.released,
      }
    : null;
}

/** Operator counts only; never list recipients, plans or meeting points. */
export async function rideReminderScheduleStatus(q: Queryable) {
  return (
    await q.query<{
      scheduled: number;
      due: number;
      released: number;
      cancelled: number;
      expired: number;
    }>(`SELECT
      count(*) FILTER(WHERE cancelled_at IS NULL AND released_at IS NULL AND deliver_after>now() AND event_occurs_at>now()+interval '5 minutes')::int scheduled,
      count(*) FILTER(WHERE cancelled_at IS NULL AND released_at IS NULL AND deliver_after<=now() AND event_occurs_at>now()+interval '5 minutes')::int due,
      count(*) FILTER(WHERE released_at IS NOT NULL)::int released,
      count(*) FILTER(WHERE cancelled_at IS NOT NULL)::int cancelled,
      count(*) FILTER(WHERE cancelled_at IS NULL AND released_at IS NULL AND event_occurs_at<=now()+interval '5 minutes')::int expired
      FROM notifications WHERE type='ride_reminder'`)
  ).rows[0];
}
