import type { Queryable } from "./db.ts";
import { authorColumns, relationshipColumns } from "./profiles.ts";

// Blocking of a person by a person (#354). The row of `user_blocks` is the
// blocker's own list; what it does is read from it where it happens, not
// copied. Two rules, both deliberate:
//  - the connection is cut both ways (follows, notices, direct messages): the
//    blocked person cannot reach the blocker, and the blocker is not reached;
//  - the content is hidden one way: the blocker no longer sees the people they
//    blocked in search and feeds, while the blocked person sees nothing new and
//    is never told (the refusals read as "unavailable").

/** SQL: either of two people has blocked the other. Arguments are SQL expressions. */
export const blockedEitherWay = (a: string, b: string) =>
  `EXISTS(SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id=${a} AND ub.blocked_id=${b}) OR (ub.blocker_id=${b} AND ub.blocked_id=${a}))`;

/** SQL: the viewer has blocked the author. A guest ($n is NULL) has blocked nobody. */
export const blockedByViewer = (viewer: string, author: string) =>
  `EXISTS(SELECT 1 FROM user_blocks ub WHERE ub.blocker_id=${viewer} AND ub.blocked_id=${author})`;

/** The same, for two known people. */
export async function blockedBetween(q: Queryable, a: string, b: string) {
  const result = await q.query<{ blocked: boolean }>(
    `SELECT ${blockedEitherWay("$1::uuid", "$2::uuid")} AS blocked`,
    [a, b],
  );
  return result.rows[0].blocked;
}

// The Stream side of a block goes by a worker, so that a vendor outage never
// fails a block on ColaBike. Only people who have both been in chat can have a
// channel to apply it to; for the others a direct message cannot be created
// while the block stands.
async function queueChatBlock(
  q: Queryable,
  blockerId: string,
  blockedId: string,
  op: "block" | "unblock",
) {
  await q.query(
    `INSERT INTO chat_block_jobs(blocker_id,blocked_id,op)
     SELECT $1::uuid,$2::uuid,$3 WHERE (SELECT count(*) FROM chat_identities WHERE user_id=ANY($4::uuid[]))=2
     ON CONFLICT(blocker_id,blocked_id) DO UPDATE SET op=EXCLUDED.op,attempts=0,next_attempt_at=now(),updated_at=clock_timestamp()`,
    [blockerId, blockedId, op, [blockerId, blockedId]],
  );
}

/**
 * Block or unblock a person. Transaction required. The two users are locked in
 * the order `setFollow` and the chat use, so a block never races a follow, a
 * direct message or the site's own blocking of an account. Blocking cuts the
 * follows both ways; unblocking gives nothing back. Repeating either is a
 * success that changes nothing.
 */
export async function setBlock(
  q: Queryable,
  blockerId: string,
  targetId: string,
  enabled: boolean,
) {
  if (targetId === blockerId)
    return { error: "Нельзя заблокировать себя", status: 400 };
  const users = (
    await q.query<{ id: string; blocked: boolean }>(
      "SELECT id,blocked FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[blockerId, targetId]],
    )
  ).rows;
  const target = users.find((u) => u.id === targetId);
  const blocker = users.find((u) => u.id === blockerId);
  if (!blocker || blocker.blocked)
    return { error: "Войдите в аккаунт.", status: 401 };
  if (enabled) {
    if (!target || target.blocked)
      return { error: "Профиль недоступен", status: 404 };
    const inserted = await q.query(
      "INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [blockerId, targetId],
    );
    await q.query(
      "DELETE FROM user_follows WHERE (follower_id=$1 AND following_id=$2) OR (follower_id=$2 AND following_id=$1)",
      [blockerId, targetId],
    );
    if (inserted.rowCount)
      await queueChatBlock(q, blockerId, targetId, "block");
  } else {
    const removed = await q.query(
      "DELETE FROM user_blocks WHERE blocker_id=$1 AND blocked_id=$2",
      [blockerId, targetId],
    );
    if (removed.rowCount)
      await queueChatBlock(q, blockerId, targetId, "unblock");
  }
  return { blocked: enabled };
}

/**
 * The people a person has blocked, newest block first, by keyset (API v1).
 * `after` is the last row's block time (microseconds, as PostgreSQL prints it)
 * and user id. A person the site has blocked is not listed: they have no
 * profile to show, and the block row goes with the account.
 */
export async function blockedKeysetPage(
  q: Queryable,
  viewerId: string,
  limit: number,
  after: { createdAt: string; id: string } | null,
) {
  // $1 is the blocker, $2 the viewer of `relationshipColumns`: the same person.
  const params: unknown[] = [viewerId, viewerId];
  const keyset = after
    ? ` AND (b.created_at,u.id)<($${params.push(after.createdAt)}::timestamptz,$${params.push(after.id)}::uuid)`
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
    `SELECT ${authorColumns},${relationshipColumns},to_char(b.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
     FROM user_blocks b JOIN users u ON u.id=b.blocked_id
     WHERE b.blocker_id=$1::uuid AND NOT u.blocked${keyset}
     ORDER BY b.created_at DESC,u.id DESC LIMIT $${params.push(limit + 1)}`,
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
