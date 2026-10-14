import { z } from "zod";
import type { Queryable } from "./db.ts";
import { db, transaction } from "./db.ts";
import { CommunityError } from "./community-validation.ts";
import { EmailPolicyError } from "./email-policy.ts";
import { rideNotice } from "./ride-notifications.ts";
import { clubEventVisible } from "./club-event-policy.ts";
import { inboxFrom } from "./notifications.ts";
export const clubNoticePreferencesInput = z
  .object({ notifyRides: z.boolean() })
  .strict();
export async function clubNoticePreferences(
  q: Queryable,
  club: string,
  actor: string,
) {
  const m = (
    await q.query<{ notify_rides: boolean; verified: Date | null }>(
      `SELECT m.notify_rides,u.email_verified_at verified FROM club_memberships m JOIN clubs c ON c.id=m.club_id JOIN users u ON u.id=m.user_id LEFT JOIN users owner ON owner.id=c.owner_id WHERE c.id=$1 AND m.user_id=$2 AND m.state='active' AND NOT u.blocked AND c.hidden_at IS NULL AND (c.owner_id IS NULL OR NOT owner.blocked)`,
      [club, actor],
    )
  ).rows[0];
  if (!m) throw new CommunityError("Настройки клуба недоступны", 404);
  return {
    viewerId: actor,
    notifyRides: m.notify_rides,
    verified: !!m.verified,
  };
}
export async function setClubNoticePreferences(
  q: Queryable,
  club: string,
  actor: string,
  input: z.infer<typeof clubNoticePreferencesInput>,
) {
  const parsed = clubNoticePreferencesInput.parse(input);
  const user = (
    await q.query<{ email_verified_at: Date | null }>(
      "SELECT email_verified_at FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
      [actor],
    )
  ).rows[0];
  if (!user) throw new CommunityError("Аккаунт недоступен", 403);
  if (parsed.notifyRides && !user.email_verified_at)
    throw new EmailPolicyError();
  await q.query("SELECT id FROM clubs WHERE id=$1 FOR UPDATE", [club]);
  await clubNoticePreferences(q, club, actor);
  await q.query(
    "UPDATE club_memberships SET notify_rides=$3,notify_rides_since=CASE WHEN $3 AND NOT notify_rides THEN now() WHEN $3 THEN notify_rides_since ELSE NULL END WHERE club_id=$1 AND user_id=$2",
    [club, actor, parsed.notifyRides],
  );
  return clubNoticePreferences(q, club, actor);
}
interface EventRow {
  id: string;
  club_id: string;
  kind: string;
  actor_id: string | null;
  target_id: string | null;
  ride_id: string | null;
  action: string | null;
  revision: string;
  target_state: string | null;
  delivered_at: Date | null;
}
export async function deliverClubEvent(q: Queryable, id: string) {
  const event = (
    await q.query<EventRow>(
      "SELECT * FROM club_event_outbox WHERE id=$1 AND delivered_at IS NULL",
      [id],
    )
  ).rows[0];
  if (!event) return false;
  const before = (
    await q.query<{ chat_revision: string }>(
      "SELECT chat_revision::text FROM clubs WHERE id=$1",
      [event.club_id],
    )
  ).rows[0];
  if (!before) return false;
  // Acquire all FK users before the club. The chat revision fences changes in
  // the candidate cohort while waiting; new people never need a later user lock.
  await q.query(
    `SELECT id FROM users WHERE id IN (
  SELECT user_id FROM club_memberships WHERE club_id=$1
  UNION SELECT owner_id FROM rides WHERE club_id=$1
  UNION SELECT v.user_id FROM ride_rsvps v JOIN rides r ON r.id=v.ride_id WHERE r.club_id=$1
  UNION SELECT i.user_id FROM ride_invitations i JOIN rides r ON r.id=i.ride_id WHERE r.club_id=$1
  UNION SELECT $2::uuid UNION SELECT $3::uuid) ORDER BY id FOR UPDATE`,
    [event.club_id, event.actor_id, event.target_id],
  );
  const current = (
    await q.query<{ chat_revision: string }>(
      "SELECT chat_revision::text FROM clubs WHERE id=$1 FOR UPDATE",
      [event.club_id],
    )
  ).rows[0];
  if (!current || current.chat_revision !== before.chat_revision) return false;
  const held = (
    await q.query<EventRow>(
      "SELECT * FROM club_event_outbox WHERE id=$1 AND delivered_at IS NULL FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!held) return false;
  if (held.kind === "club_archived") {
    const dates = (
      await q.query<{ id: string; occurs_at: Date | null }>(
        `SELECT r.id,v.occurs_at FROM rides r LEFT JOIN ride_rsvps v ON v.ride_id=r.id AND v.occurs_at>now() AND v.response IN ('accepted','maybe') WHERE r.club_id=$1 AND ($2::uuid IS NULL OR r.id=$2) AND r.status='cancelled' AND (r.recurrence='weekly' OR r.started_at>now()) GROUP BY r.id,v.occurs_at ORDER BY r.id,v.occurs_at`,
        [held.club_id, held.ride_id],
      )
    ).rows;
    for (const date of dates)
      await rideNotice(q, date.id, "ride_cancelled", {
        occursAt: date.occurs_at,
      });
  } else {
    const type =
      held.kind === "organizer_lost"
        ? "club_organizer_lost"
        : held.kind === "ride_new"
          ? "club_ride_new"
          : held.kind === "role"
            ? "club_role"
            : held.action === "membership_join"
              ? "club_application"
              : held.action === "member_invite"
                ? "club_invitation"
                : "club_membership_result";
    // A temporary relation exposes current candidates to the exact inbox policy;
    // the same SQL is used at read/send/retry, without payload snapshots.
    await q.query(
      `WITH candidates AS (SELECT u.id recipient_id,$1::text type,$2::uuid club_event_id,$3::uuid club_id,NULL::uuid actor_id,NULL::uuid listing_id,NULL::uuid bike_id,NULL::uuid comment_id,NULL::uuid ride_id,NULL::uuid ride_comment_id,NULL::uuid entry_id,NULL::uuid entry_comment_id,NULL::uuid component_id,NULL::uuid component_comment_id,NULL::uuid intent_id,NULL::uuid club_post_id,NULL::uuid club_post_comment_id FROM users u WHERE NOT u.blocked AND EXISTS(SELECT 1 FROM club_memberships candidate WHERE candidate.club_id=$3 AND candidate.user_id=u.id)), eligible AS (
   SELECT n.recipient_id ${inboxFrom.replace(" FROM notifications n ", " FROM candidates n ")} WHERE ${clubEventVisible()}), made AS (
   INSERT INTO notifications(id,recipient_id,type,club_id,club_event_id,dedup_key)
   SELECT gen_random_uuid(),recipient_id,$1,$3,$2,$1||':'||$2::text FROM eligible
   ON CONFLICT(recipient_id,dedup_key) DO NOTHING RETURNING id)
   SELECT count(*) FROM made`,
      [type, held.id, held.club_id],
    );
  }
  await q.query("UPDATE club_event_outbox SET delivered_at=now() WHERE id=$1", [
    held.id,
  ]);
  return true;
}
export async function runClubEventBatch(limit = 20) {
  const jobs = (
    await db.query<{ id: string }>(
      "SELECT id FROM club_event_outbox WHERE delivered_at IS NULL ORDER BY created_at,id LIMIT $1",
      [Math.max(1, Math.min(100, limit))],
    )
  ).rows;
  let delivered = 0;
  for (const job of jobs)
    if (await transaction((q) => deliverClubEvent(q, job.id))) delivered++;
  return { delivered };
}
