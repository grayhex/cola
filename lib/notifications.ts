import type { Queryable as QueryableType } from "./repository.ts";
import type { Queryable } from "./db.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { publicAuthor } from "./profile-dto.ts";
import { profilePath } from "./public-urls.ts";
import { expiryNoticeDays } from "./market.ts";
import { partLandingPath } from "./experience-catalog.ts";
import { mailEnabled } from "./mail.ts";
import {
  notificationCategoryOf,
  notificationEmailEnqueueSql,
  notificationTypesOf,
  type NotificationCategoryKey,
} from "./notification-catalog.ts";
import { rideNoticeVisible } from "./ride-notification-policy.ts";
import { rideOccurrence } from "./ride-occurrence.ts";
// Keep one lifetime follow/like event. The discussion events are told apart
// (#341): the identity of an event is its comment, the group is what one author
// does to one object in a quarter of an hour. While the newest notice of a group
// is unread, a further event of the group adds nothing: the person has one
// notice, which opens the first comment they have not read, and the rest of the
// thread is under it. Once that notice has been read the next event gets a
// notice of its own, so a direct reply after the previous one was read is never
// lost. Repeating one event (the same comment) changes nothing. Never reset
// created_at or read_at, including unlike/like and refollow.
const groupedTypes =
  "('comment','reply','ride_comment','ride_reply','journal_comment','journal_reply','component_reply')";

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
  // The event itself: the comment the notice is about.
  const event = comment || rideComment || entryComment || componentComment;
  await q.query(
    `WITH k AS (SELECT $7::text || CASE WHEN $4 IN ${groupedTypes} THEN ':' || floor(extract(epoch from now())/900)::bigint::text ELSE '' END AS group_key),
 grp AS (SELECT n.id,n.read_at FROM notifications n,k
  WHERE $4 IN ${groupedTypes} AND n.recipient_id=$2 AND (n.group_key=k.group_key OR (n.group_key IS NULL AND n.dedup_key=k.group_key))
  ORDER BY n.created_at DESC,n.id LIMIT 1),
 created AS (INSERT INTO notifications(id,recipient_id,actor_id,type,bike_id,comment_id,dedup_key,group_key,ride_id,ride_comment_id,entry_id,entry_comment_id,component_id,component_comment_id)
 SELECT $1,$2,$3,$4,$5,$6,CASE WHEN EXISTS(SELECT 1 FROM grp) THEN k.group_key || ':' || coalesce($15::text,$1::uuid::text) ELSE k.group_key END,
  CASE WHEN $4 IN ${groupedTypes} THEN k.group_key END,$8,$9,$10,$11,$12,$13
 FROM k WHERE EXISTS(SELECT 1 FROM users WHERE id=$2 AND NOT blocked) AND EXISTS(SELECT 1 FROM users WHERE id=$3 AND NOT blocked)
  AND NOT EXISTS(SELECT 1 FROM grp WHERE read_at IS NULL)
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
      event,
    ],
  );
}
// Evaluate visibility at read time: no stored bike names, URLs, HTML or private snapshots.
// A notice from the site (market_expiring) has no actor (#116).
export const inboxFrom = ` FROM notifications n LEFT JOIN users a ON a.id=n.actor_id
 LEFT JOIN market_listings ml ON ml.id=n.listing_id
 LEFT JOIN bikes b ON b.id=n.bike_id LEFT JOIN users o ON o.id=b.owner_id
 LEFT JOIN bike_comments c ON c.id=n.comment_id LEFT JOIN rides r ON r.id=n.ride_id LEFT JOIN bikes rb ON rb.id=r.bike_id LEFT JOIN users ro ON ro.id=r.owner_id LEFT JOIN ride_comments rc ON rc.id=n.ride_comment_id
 LEFT JOIN journal_entries e ON e.id=n.entry_id LEFT JOIN bikes eb ON eb.id=e.bike_id LEFT JOIN users eo ON eo.id=e.owner_id LEFT JOIN journal_comments ec ON ec.id=n.entry_comment_id
 LEFT JOIN component_models cs ON cs.id=n.component_id LEFT JOIN component_models cm ON cm.id=coalesce(cs.merged_into,cs.id)
 LEFT JOIN component_comments cc ON cc.id=n.component_comment_id LEFT JOIN ride_intents ri ON ri.id=n.intent_id`;
export const inboxVisible = (
  clock = "now()",
) => `n.recipient_id=$1 AND ((n.type='bike_week' AND b.owner_id=n.recipient_id AND b.is_public AND NOT o.blocked AND NOT b.leaderboard_excluded AND EXISTS(SELECT 1 FROM bike_weeks w WHERE w.bike_id=b.id AND w.owner_id=n.recipient_id AND w.status='selected' AND w.week_start=date_trunc('week',(${clock}) AT TIME ZONE 'Europe/Moscow')::date AND n.dedup_key='bike_week:'||w.week_start::text||':'||b.id::text)) OR (n.type='market_expiring' AND ml.owner_id=n.recipient_id) OR n.type='session_reuse' OR ${rideNoticeVisible(clock)} OR NOT a.blocked AND (
 (n.type='component_reply' AND cm.first_public_at IS NOT NULL AND cc.deleted_at IS NULL AND cc.author_id=n.actor_id) OR
 (n.type='plan_published' AND r.owner_id=n.actor_id AND r.status='planned' AND r.is_public AND rb.is_public AND NOT ro.blocked AND (${rideOccurrence.replaceAll("now()", `(${clock})`)})>(${clock})) OR
 (n.type='intent_published' AND ri.owner_id=n.actor_id AND ri.visibility='community' AND ri.status='active' AND EXISTS(SELECT 1 FROM ride_intent_windows w WHERE w.intent_id=ri.id AND w.ends_at>(${clock}))) OR
 (n.type='follow' AND EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_id=n.actor_id AND f.following_id=n.recipient_id)) OR
 (b.is_public AND NOT o.blocked AND (
  (n.type='like' AND EXISTS(SELECT 1 FROM bike_likes l WHERE l.bike_id=b.id AND l.user_id=n.actor_id)) OR
  (n.type IN ('comment','reply') AND c.deleted_at IS NULL AND c.author_id=n.actor_id))) OR (r.is_public AND rb.is_public AND NOT ro.blocked AND ((n.type='ride_like' AND EXISTS(SELECT 1 FROM ride_likes l WHERE l.ride_id=r.id AND l.user_id=n.actor_id)) OR (n.type IN ('ride_comment','ride_reply') AND rc.deleted_at IS NULL AND rc.author_id=n.actor_id))) OR
 (e.status='published' AND e.is_public AND (e.kind='article' OR eb.is_public) AND NOT eo.blocked AND ((n.type='journal_like' AND EXISTS(SELECT 1 FROM journal_likes l WHERE l.entry_id=e.id AND l.user_id=n.actor_id)) OR (n.type IN ('journal_comment','journal_reply') AND ec.deleted_at IS NULL AND ec.author_id=n.actor_id)))))`;
export async function unreadCount(q: Queryable, id: string, now = new Date()) {
  const r = await q.query<{ id: string }>(
    "SELECT n.id" +
      inboxFrom +
      " WHERE " +
      inboxVisible("$2::timestamptz") +
      " AND n.read_at IS NULL ORDER BY n.created_at DESC,n.id LIMIT 100",
    [id, now],
  );
  return { unread: r.rows.length, capped: r.rows.length === 100 };
}
// The mark a "read all" counts up to (#341): the newest notice the recipient can
// see now, at the microsecond PostgreSQL keeps. A notice that arrives after
// the list was drawn sorts before it, so it can never be read unseen; the
// opaque text the clients get is made of it by `encodeWatermark`.
export interface InboxWatermark {
  createdAt: string;
  id: string;
}
const microseconds = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
export async function inboxWatermark(
  q: Queryable,
  id: string,
  now = new Date(),
): Promise<InboxWatermark | null> {
  const r = await q.query<{ created_at: string; id: string }>(
    `SELECT ${microseconds("n.created_at")} created_at,n.id` +
      inboxFrom +
      " WHERE " +
      inboxVisible("$2::timestamptz") +
      " ORDER BY n.created_at DESC,n.id LIMIT 1",
    [id, now],
  );
  const row = r.rows[0];
  return row ? { createdAt: row.created_at, id: row.id } : null;
}
/**
 * How many are unread and the mark to read them up to (as the opaque text the
 * clients send back): what a badge and a list both carry.
 */
export async function inboxState(q: Queryable, id: string, now = new Date()) {
  const mark = await inboxWatermark(q, id, now);
  return {
    ...(await unreadCount(q, id, now)),
    watermark: mark ? encodeWatermark(mark) : null,
  };
}
export interface NotificationRow {
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
  intent_id: string;
  bike_id: string;
  share_id: string;
  bike_name: string;
  actor_id: string;
  username: string;
  name: string;
  avatar_id: string;
  event_occurs_at: Date | null;
  event_revision: number | null;
}
// One notice as the site and the API show it: the text follows what the
// notice is about now, and the address is a path on the site. The target also
// says in typed fields which comment, which date and which version of the
// agreements it is about (#341), so that an app never has to read them out of
// the address; a historical notice has them null and keeps its address.
export function notificationCard(n: NotificationRow) {
  return {
    ...plainCard(n, {
      commentId:
        n.comment_id ||
        n.ride_comment_id ||
        n.entry_comment_id ||
        n.component_comment_id ||
        null,
      occurrenceAt: n.event_occurs_at ?? null,
      agreementRevision: n.event_revision ?? null,
    }),
    category: notificationCategoryOf(n.type),
  };
}
type TypedTarget = {
  commentId: string | null;
  occurrenceAt: Date | null;
  agreementRevision: number | null;
};
function plainCard(n: NotificationRow, typed: TypedTarget) {
  return n.type === "session_reuse"
    ? {
        id: n.id,
        type: "session_reuse" as const,
        createdAt: n.created_at,
        readAt: n.read_at,
        actor: null,
        target: {
          type: "account" as const,
          id: n.id,
          name: "Безопасность аккаунта",
          href: "/account?tab=account",
          ...typed,
        },
      }
    : n.type === "bike_week"
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
            ...typed,
          },
        }
      : n.type === "market_expiring"
        ? marketNotice(n, typed)
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
                    ...typed,
                  }
                : n.type.startsWith("journal_")
                  ? {
                      type: n.entry_kind === "article" ? "article" : "journal",
                      id: n.entry_id,
                      name: n.entry_title,
                      href:
                        (n.entry_kind === "article" ? "/articles/" : "/j/") +
                        n.entry_share +
                        (n.entry_comment_id
                          ? "?comment=" + n.entry_comment_id + "#discussion"
                          : ""),
                      ...typed,
                    }
                  : n.type === "intent_published"
                    ? {
                        type: "intent",
                        id: n.intent_id,
                        name: "Намерение покататься",
                        href: "/ride-intents",
                        ...typed,
                      }
                    : n.type.startsWith("ride_") || n.type === "plan_published"
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
                          ...typed,
                        }
                      : n.type === "follow"
                        ? {
                            type: "profile",
                            id: n.actor_id,
                            name: n.name,
                            href: profilePath(n.username),
                            ...typed,
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
                            ...typed,
                          },
          };
}
// A function: the notice days come from market.ts, which imports this module.
const notificationColumns = () =>
  `n.id,n.type,n.created_at,n.read_at,n.event_occurs_at,n.event_revision,n.comment_id,n.ride_comment_id,n.entry_comment_id,n.component_comment_id,cm.id component_id,cm.name component_name,cm.category_slug,cm.slug,ml.id AS listing_id,ml.share_id AS listing_share,ml.title AS listing_title,ml.status AS listing_status,ml.expires_at AS listing_expires,(ml.expires_at<=now()) AS listing_expired,(ml.expires_at<=now()+make_interval(days=>${expiryNoticeDays})) AS listing_due,e.id AS entry_id,e.kind AS entry_kind,e.share_id AS entry_share,e.title AS entry_title,r.id AS ride_id,r.share_id AS ride_share_id,r.title AS ride_title,n.intent_id,b.id AS bike_id,b.share_id,b.name AS bike_name,a.id AS actor_id,a.username,a.name,a.avatar_id`;
export async function notificationPage(
  q: Queryable,
  id: string,
  page = 1,
  notificationId: string | null = null,
  now = new Date(),
  // The same two filters as the API's list (#341): only the unread, one category.
  { unread = false, category }: InboxFilter = {},
) {
  const r = await q.query<NotificationRow>(
    `SELECT ${notificationColumns()}` +
      inboxFrom +
      " WHERE " +
      inboxVisible("$4::timestamptz") +
      " AND ($3::uuid IS NULL OR n.id=$3) AND ($5::boolean IS NOT TRUE OR n.read_at IS NULL) AND ($6::text[] IS NULL OR n.type=ANY($6::text[]))" +
      " ORDER BY n.created_at DESC,n.id LIMIT 21 OFFSET $2",
    [
      id,
      (page - 1) * 20,
      notificationId,
      now,
      unread,
      category ? notificationTypesOf(category) : null,
    ],
  );
  return {
    notifications: r.rows.slice(0, 20).map(notificationCard),
    page,
    hasMore: r.rows.length > 20,
    ...(await inboxState(q, id, now)),
  };
}
/**
 * The same notices and the same visibility rule as `notificationPage`, by
 * `(created_at DESC, id)` and a cursor instead of OFFSET (API v1, #321).
 */
export async function notificationKeysetPage(
  q: Queryable,
  recipient: string,
  limit: number,
  after: { createdAt: string; id: string } | null,
  now = new Date(),
  // The two filters of an inbox: only the unread, only one category (#341).
  { unread = false, category }: InboxFilter = {},
) {
  const rows = (
    await q.query<NotificationRow & { cursor_at: string }>(
      `SELECT ${notificationColumns()},${microseconds("n.created_at")} cursor_at` +
        inboxFrom +
        " WHERE " +
        inboxVisible("$2::timestamptz") +
        " AND ($3::timestamptz IS NULL OR n.created_at<$3::timestamptz OR (n.created_at=$3::timestamptz AND n.id>$4::uuid))" +
        " AND ($6::boolean IS NOT TRUE OR n.read_at IS NULL) AND ($7::text[] IS NULL OR n.type=ANY($7::text[]))" +
        " ORDER BY n.created_at DESC,n.id LIMIT $5",
      [
        recipient,
        now,
        after?.createdAt ?? null,
        after?.id ?? null,
        limit + 1,
        unread,
        category ? notificationTypesOf(category) : null,
      ],
    )
  ).rows;
  const page = rows.slice(0, limit),
    last = page[page.length - 1];
  return {
    items: page.map(notificationCard),
    next:
      rows.length > limit && last
        ? { createdAt: last.cursor_at, id: last.id }
        : null,
  };
}
// The listing's state is read now, not stored with the notice: the text
// follows an extension, a sale or the end of the term.
function marketNotice(n: NotificationRow, typed: TypedTarget) {
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
      ...typed,
      expiresAt: n.listing_expires,
      state:
        n.listing_status !== "active"
          ? ("closed" as const)
          : n.listing_expired
            ? ("expired" as const)
            : n.listing_due
              ? ("expiring" as const)
              : ("extended" as const),
    },
  };
}
export interface InboxFilter {
  unread?: boolean;
  category?: NotificationCategoryKey;
}

// ---- Read-state (#341) ----------------------------------------------------
// Reading is the one fact the server keeps about what a person has done with a
// notice. Showing it, opening it and dismissing it from a tray are the client's
// own: fetching a list or swiping a notification marks nothing. Only the
// recipient's own, already delivered notices can be marked, and marking twice
// is the same as marking once.

/** A watermark as the clients see it: opaque, and different from a page cursor. */
const watermarkShape = z.strictObject({
  w: z.literal(1),
  t: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  i: z.uuid(),
});
export function encodeWatermark(mark: InboxWatermark): string {
  return Buffer.from(
    JSON.stringify({ w: 1, t: mark.createdAt, i: mark.id }),
  ).toString("base64url");
}
/** The mark of a text the server issued, or null for anything else. */
export function decodeWatermark(raw: string): InboxWatermark | null {
  try {
    const parsed = watermarkShape.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    return { createdAt: parsed.t, id: parsed.i };
  } catch {
    return null;
  }
}

/**
 * The mark of a text this person was given, or null. The shape alone proves
 * nothing, so the text must also name a notice of this recipient at exactly that
 * instant: a mark taken from another account, made up, or of a notice that is
 * gone is not a boundary anyone may read up to (an app that kept the mark of
 * the account it left must not read the new account's notices unseen).
 */
export async function inboxWatermarkOf(
  q: Queryable,
  userId: string,
  raw: string,
): Promise<InboxWatermark | null> {
  const mark = decodeWatermark(raw);
  if (!mark) return null;
  const { rowCount } = await q.query(
    "SELECT 1 FROM notifications WHERE recipient_id=$1 AND id=$2 AND created_at=$3::timestamptz",
    [userId, mark.id, mark.createdAt],
  );
  return rowCount ? mark : null;
}

export type ReadScope =
  | { ids: string[] }
  | { upTo: InboxWatermark; category?: NotificationCategoryKey };
export const readLimits = { ids: 100, upTo: 10000 };

/**
 * Marks notices read. `ids` are the ones a person named (the screen they were
 * on); `upTo` is "everything up to this mark", of the notices they can see now
 * (so one that is still hidden is not read before it was ever shown). Returns
 * how many were marked now and how many of the named ones exist for them.
 */
export async function markNotificationsRead(
  q: Queryable,
  userId: string,
  scope: ReadScope,
  now = new Date(),
) {
  if ("ids" in scope) {
    const ids = [...new Set(scope.ids)].slice(0, readLimits.ids);
    const marked = await q.query<{ id: string }>(
      "UPDATE notifications SET read_at=now() WHERE recipient_id=$1 AND deliver_after<=now() AND id=ANY($2::uuid[]) AND read_at IS NULL RETURNING id",
      [userId, ids],
    );
    const found = await q.query<{ n: number }>(
      "SELECT count(*)::int n FROM notifications WHERE recipient_id=$1 AND deliver_after<=now() AND id=ANY($2::uuid[])",
      [userId, ids],
    );
    return { marked: marked.rows.length, found: found.rows[0].n };
  }
  const marked = await q.query<{ id: string }>(
    `WITH unread AS (SELECT n.id` +
      inboxFrom +
      " WHERE " +
      inboxVisible("$2::timestamptz") +
      ` AND n.read_at IS NULL AND (n.created_at<$3::timestamptz OR (n.created_at=$3::timestamptz AND n.id>=$4::uuid))
      AND ($5::text[] IS NULL OR n.type=ANY($5::text[]))
      ORDER BY n.created_at DESC,n.id LIMIT ${readLimits.upTo} FOR UPDATE OF n)
    UPDATE notifications SET read_at=now() WHERE id IN (SELECT id FROM unread) RETURNING id`,
    [
      userId,
      now,
      scope.upTo.createdAt,
      scope.upTo.id,
      scope.category ? notificationTypesOf(scope.category) : null,
    ],
  );
  return { marked: marked.rows.length, found: marked.rows.length };
}
/**
 * Compatibility of the site's first read routes: one id answers whether it is
 * the recipient's, and no id reads what exists now (the notices that arrive
 * during the request stay unread).
 */
export async function readNotifications(
  q: Queryable,
  userId: string,
  id: string | null = null,
) {
  if (id)
    return (await markNotificationsRead(q, userId, { ids: [id] })).found > 0;
  const mark = await inboxWatermark(q, userId);
  if (mark) await markNotificationsRead(q, userId, { upTo: mark });
  return true;
}
