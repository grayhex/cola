import type { Queryable as QueryableType } from "./repository.ts";
import type { Queryable } from "./db.ts";
import { randomUUID } from "node:crypto";
import { publicAuthor } from "./profile-dto.ts";
import { profilePath } from "./public-urls.ts";
import { expiryNoticeDays } from "./market.ts";
import { partLandingPath } from "./experience-catalog.ts";
import { mailEnabled } from "./mail.ts";
import { notificationEmailEnqueueSql } from "./notification-catalog.ts";
import { rideNoticeVisible } from "./ride-notification-policy.ts";
// Keep one lifetime follow/like event; comments/replies coalesce per actor/bike/15m.
// Never reset created_at or read_at on conflict, including unlike/like and refollow.

export async function notify(
  q: QueryableType,
  {
    recipient,
    actor,
    type,
    bike = null,
    comment = null,
    ride = null,
    rideComment = null,
    entry = null,
    entryComment = null,
    component = null,
    componentComment = null,
  }: {
    recipient: string | null;
    actor: string;
    type: string;
    bike?: string | null;
    comment?: string | null;
    ride?: string | null;
    rideComment?: string | null;
    entry?: string | null;
    entryComment?: string | null;
    component?: string | null;
    componentComment?: string | null;
  },
) {
  if (!recipient || recipient === actor) return;
  const key = `${type}:${actor}:${component || entry || ride || bike || ""}`;
  await q.query(
    `WITH created AS (INSERT INTO notifications(id,recipient_id,actor_id,type,bike_id,comment_id,dedup_key,ride_id,ride_comment_id,entry_id,entry_comment_id,component_id,component_comment_id)
 SELECT $1,$2,$3,$4,$5,$6,$7 || CASE WHEN $4 IN ('comment','reply','ride_comment','ride_reply','journal_comment','journal_reply','component_reply') THEN ':' || floor(extract(epoch from now())/900)::bigint::text ELSE '' END,$8,$9,$10,$11,$12,$13 WHERE EXISTS(SELECT 1 FROM users WHERE id=$2 AND NOT blocked) AND EXISTS(SELECT 1 FROM users WHERE id=$3 AND NOT blocked)
 ON CONFLICT(recipient_id,dedup_key) DO NOTHING RETURNING id,recipient_id,type)
 ${notificationEmailEnqueueSql("$14::boolean")}`,
    [
      randomUUID(),
      recipient,
      actor,
      type,
      bike,
      comment,
      key,
      ride,
      rideComment,
      entry,
      entryComment,
      component,
      componentComment,
      mailEnabled(),
    ],
  );
}
// Evaluate visibility at read time: no stored bike names, URLs, HTML or private snapshots.
// A notice from the site (market_expiring) has no actor (#116).
const from = ` FROM notifications n LEFT JOIN users a ON a.id=n.actor_id
 LEFT JOIN market_listings ml ON ml.id=n.listing_id
 LEFT JOIN bikes b ON b.id=n.bike_id LEFT JOIN users o ON o.id=b.owner_id
 LEFT JOIN bike_comments c ON c.id=n.comment_id LEFT JOIN rides r ON r.id=n.ride_id LEFT JOIN bikes rb ON rb.id=r.bike_id LEFT JOIN users ro ON ro.id=r.owner_id LEFT JOIN ride_comments rc ON rc.id=n.ride_comment_id
 LEFT JOIN journal_entries e ON e.id=n.entry_id LEFT JOIN bikes eb ON eb.id=e.bike_id LEFT JOIN users eo ON eo.id=e.owner_id LEFT JOIN journal_comments ec ON ec.id=n.entry_comment_id
 LEFT JOIN component_models cs ON cs.id=n.component_id LEFT JOIN component_models cm ON cm.id=coalesce(cs.merged_into,cs.id)
 LEFT JOIN component_comments cc ON cc.id=n.component_comment_id`;
const visible = (
  clock = "now()",
) => `n.recipient_id=$1 AND ((n.type='bike_week' AND b.owner_id=n.recipient_id AND b.is_public AND NOT o.blocked AND NOT b.leaderboard_excluded AND EXISTS(SELECT 1 FROM bike_weeks w WHERE w.bike_id=b.id AND w.owner_id=n.recipient_id AND w.status='selected' AND w.week_start=date_trunc('week',(${clock}) AT TIME ZONE 'Europe/Moscow')::date AND n.dedup_key='bike_week:'||w.week_start::text||':'||b.id::text)) OR (n.type='market_expiring' AND ml.owner_id=n.recipient_id) OR ${rideNoticeVisible(clock)} OR NOT a.blocked AND (
 (n.type='component_reply' AND cm.first_public_at IS NOT NULL AND cc.deleted_at IS NULL AND cc.author_id=n.actor_id) OR
 (n.type='follow' AND EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_id=n.actor_id AND f.following_id=n.recipient_id)) OR
 (b.is_public AND NOT o.blocked AND (
  (n.type='like' AND EXISTS(SELECT 1 FROM bike_likes l WHERE l.bike_id=b.id AND l.user_id=n.actor_id)) OR
  (n.type IN ('comment','reply') AND c.deleted_at IS NULL AND c.author_id=n.actor_id))) OR (r.is_public AND rb.is_public AND NOT ro.blocked AND ((n.type='ride_like' AND EXISTS(SELECT 1 FROM ride_likes l WHERE l.ride_id=r.id AND l.user_id=n.actor_id)) OR (n.type IN ('ride_comment','ride_reply') AND rc.deleted_at IS NULL AND rc.author_id=n.actor_id))) OR
 (e.status='published' AND e.is_public AND (e.kind='article' OR eb.is_public) AND NOT eo.blocked AND ((n.type='journal_like' AND EXISTS(SELECT 1 FROM journal_likes l WHERE l.entry_id=e.id AND l.user_id=n.actor_id)) OR (n.type IN ('journal_comment','journal_reply') AND ec.deleted_at IS NULL AND ec.author_id=n.actor_id)))))`;
export async function unreadCount(q: Queryable, id: string, now = new Date()) {
  const r = await q.query<{ id: string }>(
    "SELECT n.id" +
      from +
      " WHERE " +
      visible("$2::timestamptz") +
      " AND n.read_at IS NULL ORDER BY n.created_at DESC,n.id LIMIT 100",
    [id, now],
  );
  return { unread: r.rows.length, capped: r.rows.length === 100 };
}
interface NotificationRow {
  id: string;
  type: string;
  created_at: Date;
  read_at: Date | null;
  comment_id: string;
  ride_comment_id: string;
  entry_comment_id: string;
  component_comment_id: string;
  component_id: string;
  component_name: string;
  category_slug: string;
  slug: string;
  listing_id: string;
  listing_share: string;
  listing_title: string;
  listing_status: string;
  listing_expires: Date;
  listing_expired: boolean;
  listing_due: boolean;
  entry_id: string;
  entry_kind: string;
  entry_share: string;
  entry_title: string;
  ride_id: string;
  ride_share_id: string;
  ride_title: string;
  bike_id: string;
  share_id: string;
  bike_name: string;
  actor_id: string;
  username: string;
  name: string;
  avatar_id: string;
}
export async function notificationPage(
  q: Queryable,
  id: string,
  page = 1,
  notificationId: string | null = null,
  now = new Date(),
) {
  const r = await q.query<NotificationRow>(
    `SELECT n.id,n.type,n.created_at,n.read_at,n.comment_id,n.ride_comment_id,n.entry_comment_id,n.component_comment_id,cm.id component_id,cm.name component_name,cm.category_slug,cm.slug,ml.id AS listing_id,ml.share_id AS listing_share,ml.title AS listing_title,ml.status AS listing_status,ml.expires_at AS listing_expires,(ml.expires_at<=now()) AS listing_expired,(ml.expires_at<=now()+make_interval(days=>${expiryNoticeDays})) AS listing_due,e.id AS entry_id,e.kind AS entry_kind,e.share_id AS entry_share,e.title AS entry_title,r.id AS ride_id,r.share_id AS ride_share_id,r.title AS ride_title,b.id AS bike_id,b.share_id,b.name AS bike_name,a.id AS actor_id,a.username,a.name,a.avatar_id` +
      from +
      " WHERE " +
      visible("$4::timestamptz") +
      " AND ($3::uuid IS NULL OR n.id=$3) ORDER BY n.created_at DESC,n.id LIMIT 21 OFFSET $2",
    [id, (page - 1) * 20, notificationId, now],
  );
  return {
    notifications: r.rows.slice(0, 20).map((n) =>
      n.type === "bike_week"
        ? {
            id: n.id,
            type: "bike_week" as const,
            createdAt: n.created_at,
            readAt: n.read_at,
            actor: null,
            target: {
              type: "bike-week" as const,
              id: n.bike_id,
              name: n.bike_name,
              href: "/account?tab=spotlight",
            },
          }
        : n.type === "market_expiring"
          ? marketNotice(n)
          : {
              id: n.id,
              type:
                n.entry_kind === "article"
                  ? n.type.replace("journal_", "article_")
                  : n.type,
              createdAt: n.created_at,
              readAt: n.read_at,
              actor: n.actor_id
                ? publicAuthor({
                    id: n.actor_id,
                    username: n.username,
                    name: n.name,
                    avatar_id: n.avatar_id,
                  })
                : null,
              target:
                n.type === "component_reply"
                  ? {
                      type: "component",
                      id: n.component_id,
                      name: n.component_name,
                      href:
                        partLandingPath(n.category_slug, n.slug) +
                        "?comment=" +
                        n.component_comment_id +
                        "#discussion",
                    }
                  : n.type.startsWith("journal_")
                    ? {
                        type:
                          n.entry_kind === "article" ? "article" : "journal",
                        id: n.entry_id,
                        name: n.entry_title,
                        href:
                          (n.entry_kind === "article" ? "/articles/" : "/j/") +
                          n.entry_share +
                          (n.entry_comment_id
                            ? "?comment=" + n.entry_comment_id + "#discussion"
                            : ""),
                      }
                    : n.type.startsWith("ride_")
                      ? {
                          type: "ride",
                          id: n.ride_id,
                          name: n.ride_title,
                          href:
                            "/r/" +
                            n.ride_share_id +
                            (n.ride_comment_id
                              ? "?comment=" + n.ride_comment_id + "#discussion"
                              : ""),
                        }
                      : n.type === "follow"
                        ? {
                            type: "profile",
                            id: n.actor_id,
                            name: n.name,
                            href: profilePath(n.username),
                          }
                        : {
                            type: "bike",
                            id: n.bike_id,
                            name: n.bike_name,
                            href:
                              "/b/" +
                              n.share_id +
                              (n.comment_id
                                ? "?comment=" + n.comment_id + "#discussion"
                                : ""),
                          },
            },
    ),
    page,
    hasMore: r.rows.length > 20,
    ...(await unreadCount(q, id, now)),
  };
}
// The listing's state is read now, not stored with the notice: the text
// follows an extension, a sale or the end of the term.
function marketNotice(n: NotificationRow) {
  return {
    id: n.id,
    type: "market_expiring" as const,
    createdAt: n.created_at,
    readAt: n.read_at,
    actor: null,
    target: {
      type: "market",
      id: n.listing_id,
      name: n.listing_title,
      href: "/market/" + n.listing_share,
      expiresAt: n.listing_expires,
      state:
        n.listing_status !== "active"
          ? "closed"
          : n.listing_expired
            ? "expired"
            : n.listing_due
              ? "expiring"
              : "extended",
    },
  };
}
export async function readNotifications(
  q: Queryable,
  userId: string,
  id: string | null = null,
) {
  const r = await q.query<{ id: string }>(
    "UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE recipient_id=$1 AND deliver_after<=now() AND (($2::uuid IS NULL AND read_at IS NULL) OR id=$2) RETURNING id",
    [userId, id],
  );
  return id ? !!r.rowCount : true;
}
