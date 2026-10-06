import type { Queryable } from "./db.ts";
import { notify } from "./notifications.ts";
import { participation } from "./participation.ts";
import { authorColumns, relationshipColumns, profileRow } from "./profiles.ts";
import { publicAuthor, relationship } from "./profile-dto.ts";
import { blockedBetween } from "./user-blocks.ts";
export async function followPage(
  q: Queryable,
  username: string,
  viewerId: string | undefined,
  kind: string,
  page = 1,
) {
  const target = await profileRow(q, username, viewerId);
  if (!target) return null;
  const incoming = kind === "followers";
  const join = incoming ? "f.follower_id" : "f.following_id";
  const where =
    ` WHERE ${incoming ? "f.following_id" : "f.follower_id"}=$1 AND NOT u.blocked` +
    (kind === "friends"
      ? " AND EXISTS(SELECT 1 FROM user_follows r WHERE r.follower_id=f.following_id AND r.following_id=$1)"
      : "");
  const from = ` FROM user_follows f JOIN users u ON u.id=${join}`;
  const count = await q.query<{ total: number }>(
    "SELECT count(*)::int AS total" + from + where,
    [target.id],
  );
  const rows = await q.query<{
    id: string;
    username: string;
    name: string;
    avatar_id: string;
    is_self: boolean;
    is_following: boolean;
    followed_by: boolean;
    blocked_by_me: boolean;
  }>(
    `SELECT ${authorColumns},${relationshipColumns}` +
      from +
      where +
      " ORDER BY f.created_at DESC,u.id LIMIT 20 OFFSET $3",
    [target.id, viewerId || null, (page - 1) * 20],
  );
  return {
    users: rows.rows.map((row) => ({
      ...publicAuthor(row),
      relationship: relationship(row),
    })),
    total: count.rows[0].total,
    page,
    pageSize: 20,
  };
}
/**
 * One page of a person's followers or following by keyset (API v1): newest
 * follow first, ties by user id, no total. `after` is the last row's follow
 * time (microseconds, as PostgreSQL prints it) and user id; a follow added
 * during the walk sorts before the cursor and shifts nothing. People of
 * blocked accounts never appear.
 */
export async function followKeysetPage(
  q: Queryable,
  targetId: string,
  viewerId: string | null,
  kind: "followers" | "following",
  limit: number,
  after: { createdAt: string; id: string } | null,
) {
  const incoming = kind === "followers";
  const params: unknown[] = [targetId, viewerId];
  const keyset = after
    ? ` AND (f.created_at,u.id)<($${params.push(after.createdAt)}::timestamptz,$${params.push(after.id)}::uuid)`
    : "";
  const result = await q.query<{
    id: string;
    username: string;
    name: string;
    avatar_id: string;
    is_self: boolean;
    is_following: boolean;
    followed_by: boolean;
    blocked_by_me: boolean;
    cursor_at: string;
  }>(
    `SELECT ${authorColumns},${relationshipColumns},to_char(f.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
     FROM user_follows f JOIN users u ON u.id=${incoming ? "f.follower_id" : "f.following_id"}
     WHERE ${incoming ? "f.following_id" : "f.follower_id"}=$1::uuid AND NOT u.blocked${keyset}
     ORDER BY f.created_at DESC,u.id DESC LIMIT $${params.push(limit + 1)}`,
    params,
  );
  const rows = result.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    rows,
    next:
      result.rows.length > limit && last
        ? { createdAt: last.cursor_at, id: last.id }
        : null,
  };
}
// Transaction required. Stable lock order serializes opposite follows and admin blocking.
export async function setFollow(
  q: Queryable,
  viewerId: string,
  username: string,
  enabled: boolean,
) {
  const target = (
    await q.query<{ id: string }>(
      "SELECT id FROM users WHERE lower(username)=lower($1)",
      [username],
    )
  ).rows[0];
  if (!target) return { error: "Профиль недоступен", status: 404 };
  if (target.id === viewerId)
    return { error: "Нельзя подписаться на себя", status: 400 };
  const users = (
    await q.query<{ id: string; blocked: boolean }>(
      "SELECT id,blocked FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[viewerId, target.id]],
    )
  ).rows;
  if (users.length !== 2 || users.some((u) => u.blocked))
    return { error: "Профиль недоступен", status: 404 };
  // A block either way (#354) is told as an unavailable profile: the person
  // who was blocked learns nothing from the refusal. Unfollowing stays open.
  if (enabled && (await blockedBetween(q, viewerId, target.id)))
    return { error: "Профиль недоступен", status: 404 };
  if (enabled) {
    const inserted = await q.query(
      "INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [viewerId, target.id],
    );
    if (inserted.rowCount) await participation(q, viewerId, "follow");
  } else
    await q.query(
      "DELETE FROM user_follows WHERE follower_id=$1 AND following_id=$2",
      [viewerId, target.id],
    );
  if (enabled)
    await notify(q, { recipient: target.id, actor: viewerId, type: "follow" });
  const reverse = await q.query<{ "?column?": number }>(
    "SELECT 1 FROM user_follows WHERE follower_id=$1 AND following_id=$2",
    [target.id, viewerId],
  );
  return {
    relationship: {
      isSelf: false,
      following: enabled,
      followedBy: !!reverse.rowCount,
      friends: enabled && !!reverse.rowCount,
    },
  };
}
