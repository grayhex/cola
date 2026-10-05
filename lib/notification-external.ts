import type { Queryable } from "./db.ts";
import { notificationLimits } from "./notification-fanout.ts";
import {
  deliveryPolicy,
  externalVerdict,
  noticeMutedSql,
} from "./notification-policy.ts";
import { nearbyNoticeStands } from "./nearby.ts";
import { notificationPage } from "./notifications.ts";
import { interestInvitationAvailable } from "./ride-matching.ts";
import { rideOccurrence } from "./ride-occurrence.ts";

// What decides, at the moment of a send, whether an external message about a
// notice may still leave (#341, #342). E-mail and push read the same things:
// the notice must still be there, unread and visible to the person, still true
// (an invitation to a ride that was cancelled is not sent), not switched off by
// the admin, not muted, and inside what the person allowed about the time. The
// inbox keeps the notice whatever is decided here.

export type ExternalChannel = "email" | "push";
export type ExternalNotice = Awaited<
  ReturnType<typeof notificationPage>
>["notifications"][number];

export type ExternalCheck =
  | {
      code:
        "expired" | "unavailable" | "muted" | "paused" | "quiet" | "disabled";
    }
  | { defer: Date }
  | { notice: ExternalNotice };

export interface ExternalSubject {
  notificationId: string;
  recipientId: string;
  type: string;
  category: string;
  rideId: string | null;
  eventOccursAt: Date | null;
  expiresAt: Date;
}

export async function externalNoticeCheck(
  q: Queryable,
  subject: ExternalSubject,
  channel: ExternalChannel,
  now: Date,
): Promise<ExternalCheck> {
  const notice = (
    await notificationPage(
      q,
      subject.recipientId,
      1,
      subject.notificationId,
      now,
    )
  ).notifications[0];
  if (!notice || notice.readAt) return { code: "unavailable" };
  if (
    subject.type === "market_expiring" &&
    "state" in notice.target &&
    !["expiring", "expired"].includes(notice.target.state)
  )
    return { code: "unavailable" };
  // A plan told because it lies in the area the person chose: still told only
  // while it does, in an area that is still on and inside its term.
  if (
    subject.type === "plan_nearby" &&
    !(await nearbyNoticeStands(
      q,
      {
        recipientId: subject.recipientId,
        rideId: subject.rideId,
        occursAt: subject.eventOccursAt,
      },
      now,
    ))
  )
    return { code: "unavailable" };
  if (subject.type === "ride_invite") {
    if (!subject.rideId) return { code: "unavailable" };
    const invitation = (
      await q.query<{ source: string }>(
        "SELECT source FROM ride_invitations WHERE ride_id=$1 AND user_id=$2",
        [subject.rideId, subject.recipientId],
      )
    ).rows[0];
    if (
      invitation?.source === "interest" &&
      (!subject.eventOccursAt ||
        !(await interestInvitationAvailable(
          q,
          subject.rideId,
          subject.recipientId,
          subject.eventOccursAt,
          now,
        )))
    )
      return { code: "unavailable" };
    const ride = (
      await q.query<{ occurs_at: Date }>(
        `SELECT (${rideOccurrence}) occurs_at FROM rides r WHERE r.id=$1 AND r.status='planned'`,
        [subject.rideId],
      )
    ).rows[0];
    if (!ride?.occurs_at || new Date(ride.occurs_at) <= now)
      return { code: "unavailable" };
  }
  // What the person has said about when and about whom: read now, not when the
  // message was queued. The admin's switches: all external channels, the
  // channel, or the category of this message.
  const limits = await notificationLimits(q);
  if (
    !limits.externalEnabled ||
    (channel === "push" && !limits.pushEnabled) ||
    limits.disabledCategories.includes(subject.category)
  )
    return { code: "disabled" };
  const policy = await deliveryPolicy(q, subject.recipientId);
  const muted = (
    await q.query<{ muted: boolean }>(
      `SELECT ${noticeMutedSql("n")} muted FROM notifications n WHERE n.id=$1`,
      [subject.notificationId],
    )
  ).rows[0]?.muted;
  if (muted) return { code: "muted" };
  // Only a cancellation of a ride the person confirmed may break the quiet.
  const confirmed =
    subject.type === "ride_cancelled" && subject.rideId && subject.eventOccursAt
      ? !!(
          await q.query(
            "SELECT 1 FROM ride_rsvps WHERE ride_id=$1 AND user_id=$2 AND occurs_at=$3 AND response='accepted'",
            [subject.rideId, subject.recipientId, subject.eventOccursAt],
          )
        ).rowCount
      : false;
  const verdict = externalVerdict(policy, {
    type: subject.type,
    now,
    expiresAt: subject.expiresAt,
    occursAt: subject.eventOccursAt,
    confirmed,
  });
  if (verdict.action === "drop")
    return {
      code:
        verdict.reason === "paused"
          ? "paused"
          : verdict.reason === "quiet"
            ? "quiet"
            : "expired",
    };
  if (verdict.action === "defer") return { defer: verdict.until };
  return { notice };
}
