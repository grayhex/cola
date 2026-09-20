import {
  journalPublic,
  journalColumns,
  journalFrom,
  journalDto,
} from "./journal.js";
import { CommunityError } from "./community-validation.js";
import { participation } from "./participation.js";
export const followsBike = (
  bike = "b.id",
  owner = "b.owner_id",
  viewer = "$1",
) =>
  `(EXISTS(SELECT 1 FROM user_follows f WHERE f.follower_id=${viewer} AND f.following_id=${owner}) OR EXISTS(SELECT 1 FROM bike_follows f WHERE f.user_id=${viewer} AND f.bike_id=${bike}))`;
export async function journalCards(q, ids, viewer = null) {
  if (!ids.length) return [];
  const rows = (
    await q.query(
      `SELECT ${journalColumns},
 (SELECT id FROM journal_photos WHERE entry_id=e.id ORDER BY created_at,id LIMIT 1) photo_id
 ${journalFrom} WHERE e.id=ANY($1::uuid[]) AND ${journalPublic}`,
      [ids, viewer],
    )
  ).rows;
  return rows.map((e) => ({
    ...journalDto(e, viewer),
    body: e.body.slice(0, 240),
    photo: e.photo_id ? "/api/journal/media/" + e.photo_id : null,
  }));
}
export async function savedPage(q, viewer, page = 1) {
  const where = ` FROM journal_saves s JOIN journal_entries e ON e.id=s.entry_id JOIN bikes b ON b.id=e.bike_id JOIN users u ON u.id=e.owner_id WHERE s.user_id=$1 AND ${journalPublic}`;
  const total = (await q.query("SELECT count(*)::int total" + where, [viewer]))
    .rows[0].total;
  const rows = (
    await q.query(
      "SELECT e.id" +
        where +
        " ORDER BY s.created_at DESC,e.id LIMIT 24 OFFSET $2",
      [viewer, (page - 1) * 24],
    )
  ).rows;
  const cards = await journalCards(
      q,
      rows.map((r) => r.id),
      viewer,
    ),
    byId = new Map(cards.map((c) => [c.id, c]));
  return {
    entries: rows.flatMap((r) => (byId.has(r.id) ? [byId.get(r.id)] : [])),
    total,
    page,
    pageSize: 24,
  };
}
export async function setSaved(q, entry, viewer, enabled) {
  if (
    !(
      await q.query(
        "SELECT id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
        [viewer],
      )
    ).rowCount
  )
    throw new CommunityError("Пользователь недоступен", 404);
  if (enabled) {
    const row = (
      await q.query(
        `SELECT e.id${journalFrom} WHERE e.id=$1 AND ${journalPublic} FOR SHARE OF b,e`,
        [entry],
      )
    ).rows[0];
    if (!row) throw new CommunityError("Запись недоступна", 404);
    const r = await q.query(
      "INSERT INTO journal_saves(user_id,entry_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING entry_id",
      [viewer, entry],
    );
    if (r.rowCount) await participation(q, viewer, "save");
  } else
    await q.query(
      "DELETE FROM journal_saves WHERE user_id=$1 AND entry_id=$2",
      [viewer, entry],
    );
  return { saved: enabled };
}
export async function bikeFollowing(q, bike, viewer) {
  const r = (
    await q.query(
      `SELECT EXISTS(SELECT 1 FROM bike_follows f WHERE f.bike_id=b.id AND f.user_id=$2) following FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.id=$1 AND b.is_public AND NOT u.blocked`,
      [bike, viewer],
    )
  ).rows[0];
  if (!r) throw new CommunityError("Велосипед недоступен", 404);
  return r;
}
export async function setBikeFollow(q, bike, viewer, enabled) {
  if (
    !(
      await q.query(
        "SELECT id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
        [viewer],
      )
    ).rowCount
  )
    throw new CommunityError("Пользователь недоступен", 404);
  if (enabled) {
    const row = (
      await q.query(
        "SELECT b.id FROM bikes b JOIN users u ON u.id=b.owner_id WHERE b.id=$1 AND b.is_public AND NOT u.blocked FOR SHARE OF b",
        [bike],
      )
    ).rows[0];
    if (!row) throw new CommunityError("Велосипед недоступен", 404);
    const r = await q.query(
      "INSERT INTO bike_follows(user_id,bike_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING bike_id",
      [viewer, bike],
    );
    if (r.rowCount) await participation(q, viewer, "follow");
  } else
    await q.query("DELETE FROM bike_follows WHERE user_id=$1 AND bike_id=$2", [
      viewer,
      bike,
    ]);
  return { following: enabled };
}
export async function setSolution(q, entry, viewer, comment) {
  const e = (
    await q.query(
      "SELECT bike_id FROM journal_entries WHERE id=$1 AND owner_id=$2",
      [entry, viewer],
    )
  ).rows[0];
  if (!e) throw new CommunityError("Запись недоступна", 404);
  // Same owner -> bike -> entry lock order as editing and existing comments.
  if (
    !(
      await q.query(
        "SELECT id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
        [viewer],
      )
    ).rowCount
  )
    throw new CommunityError("Пользователь недоступен", 404);
  await q.query("SELECT id FROM bikes WHERE id=$1 FOR UPDATE", [e.bike_id]);
  const row = (
    await q.query(
      "SELECT id FROM journal_entries WHERE id=$1 AND owner_id=$2 AND kind='question' FOR UPDATE",
      [entry, viewer],
    )
  ).rows[0];
  if (!row)
    throw new CommunityError(
      "Решение можно выбрать только у своего вопроса",
      404,
    );
  if (
    comment &&
    !(
      await q.query(
        "SELECT c.id FROM journal_comments c JOIN users u ON u.id=c.author_id WHERE c.id=$1 AND c.entry_id=$2 AND c.deleted_at IS NULL AND NOT u.blocked FOR SHARE OF c",
        [comment, entry],
      )
    ).rowCount
  )
    throw new CommunityError("Ответ недоступен", 404);
  await q.query("UPDATE journal_entries SET solution_id=$2 WHERE id=$1", [
    entry,
    comment,
  ]);
  return { solutionId: comment };
}
