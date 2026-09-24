import { randomUUID } from "node:crypto";
import { z } from "zod";
import { uuid } from "./validation.js";
import { CommunityError } from "./community-validation.js";
import { publicAuthor } from "./profile-dto.js";
import { publicComponent } from "./public-dto.js";
import { participation } from "./participation.js";
import { parseRichText, richExcerpt } from "./rich-text.js";
export { journalKinds } from "./journal-kinds.js";
const text = (n) =>
  z
    .string()
    .trim()
    .max(n)
    .refine((s) => !s.includes("\0"));
/** @typedef {z.infer<typeof journalInput>} JournalInput */
export const journalInput = z
  .object({
    bikeId: uuid,
    kind: z.enum(["build", "service", "review", "question", "story"]),
    title: text(160),
    body: text(20000),
    status: z.enum(["draft", "published"]).default("draft"),
    isPublic: z.boolean().default(false),
    eventDate: z.iso.date().nullable().default(null),
    mileage: z.number().int().min(0).max(10000000).nullable().default(null),
    rideId: uuid.nullable().default(null),
    installationResult: z
      .enum(["direct", "modified", "failed"])
      .nullable()
      .default(null),
    componentIds: z
      .array(uuid)
      .max(50)
      .refine((a) => new Set(a).size === a.length)
      .default([]),
  })
  .strict()
  .refine(
    (v) => v.status === "draft" || (v.title.length > 0 && v.body.length > 0),
    { message: "Для публикации нужны заголовок и текст" },
  );
export const journalPublic =
  "e.status='published' AND e.is_public AND b.is_public AND NOT u.blocked";
export const journalFrom =
  " FROM journal_entries e JOIN bikes b ON b.id=e.bike_id JOIN users u ON u.id=e.owner_id";
export const journalColumns = `e.*,e.event_date::text event_date,b.name bike_name,b.share_id bike_share,b.is_public bike_public,b.show_component_prices,b.show_accessory_prices,u.username,u.name author_name,u.avatar_id,
 EXISTS(SELECT 1 FROM journal_saves s WHERE s.entry_id=e.id AND s.user_id=$2) saved,
 (SELECT c.id FROM journal_comments c JOIN users a ON a.id=c.author_id WHERE c.id=e.solution_id AND c.entry_id=e.id AND c.deleted_at IS NULL AND NOT a.blocked AND e.kind='question') visible_solution,
 (SELECT count(*)::int FROM journal_likes l JOIN users a ON a.id=l.user_id WHERE l.entry_id=e.id AND NOT a.blocked) likes,
 EXISTS(SELECT 1 FROM journal_likes l WHERE l.entry_id=e.id AND l.user_id=$2) liked,
 (SELECT count(*)::int FROM journal_comments c JOIN users a ON a.id=c.author_id WHERE c.entry_id=e.id AND c.deleted_at IS NULL AND NOT a.blocked) comments`;
export function journalDto(e, user) {
  const owner = e.owner_id === user;
  return {
    id: e.id,
    shareId: e.share_id,
    kind: e.kind,
    installationResult: e.installation_result,
    solutionId: e.visible_solution || null,
    saved: !!e.saved,
    title: e.title,
    body: e.body,
    excerpt: richExcerpt(e.body, 240),
    status: e.status,
    isPublic: e.is_public,
    bikePublic: e.bike_public,
    isOwner: owner,
    eventDate: e.event_date
      ? String(
          e.event_date instanceof Date
            ? e.event_date.toISOString()
            : e.event_date,
        ).slice(0, 10)
      : null,
    mileage: e.mileage,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
    bike: { id: e.bike_id, shareId: e.bike_share, name: e.bike_name },
    author: publicAuthor({
      id: e.owner_id,
      username: e.username,
      name: e.author_name,
      avatar_id: e.avatar_id,
    }),
    components: e.components.map((c) => ({
      ...publicComponent(
        c,
        owner ||
          (c.section === "build"
            ? e.show_component_prices
            : e.show_accessory_prices),
      ),
      capturedAt: c.capturedAt,
    })),
    likes: e.likes,
    liked: e.liked,
    comments: e.comments,
  };
}
export async function journalDetail(q, share, user = null) {
  const e = (
    await q.query(
      `SELECT ${journalColumns}${journalFrom} WHERE e.share_id=$1 AND NOT u.blocked AND (e.owner_id=$2 OR (${journalPublic}))`,
      [share, user],
    )
  ).rows[0];
  if (!e) throw new CommunityError("Запись недоступна", 404);
  const result = journalDto(e, user);
  // Parsed here, so readers render the entry without the parser (#117).
  result.bodyDoc = parseRichText(e.body);
  result.photos = (
    await q.query(
      "SELECT id FROM journal_photos WHERE entry_id=$1 ORDER BY created_at,id",
      [e.id],
    )
  ).rows.map((p) => ({ id: p.id, url: "/api/journal/media/" + p.id }));
  result.ride = null;
  if (e.ride_id) {
    const r = (
      await q.query(
        "SELECT r.id,r.share_id,r.title FROM rides r JOIN bikes b ON b.id=r.bike_id WHERE r.id=$1 AND r.bike_id=$2 AND (r.owner_id=$3 OR (r.is_public AND b.is_public))",
        [e.ride_id, e.bike_id, user],
      )
    ).rows[0];
    if (r) result.ride = { id: r.id, shareId: r.share_id, title: r.title };
  }
  return result;
}
export async function journalList(q, bike, user = null, page = 1) {
  const rows = (
    await q.query(
      `SELECT ${journalColumns}${journalFrom} WHERE e.bike_id=$1 AND NOT u.blocked AND (e.owner_id=$2 OR (${journalPublic})) ORDER BY e.created_at DESC,e.id LIMIT 21 OFFSET $3`,
      [bike, user, (page - 1) * 20],
    )
  ).rows;
  return {
    entries: rows.slice(0, 20).map((e) => {
      const d = journalDto(e, user);
      return { ...d, body: d.body.slice(0, 240) };
    }),
    page,
    hasMore: rows.length > 20,
  };
}
export async function journalBikeLock(q, bike, user) {
  const u = (
    await q.query(
      "SELECT id FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
      [user],
    )
  ).rows[0];
  if (!u) throw new CommunityError("Пользователь недоступен", 404);
  if (bike === null) return;
  const b = (
    await q.query(
      "SELECT id FROM bikes WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      [bike, user],
    )
  ).rows[0];
  if (!b) throw new CommunityError("Велосипед недоступен", 404);
}
/** @param {JournalInput} input */
export async function saveJournal(q, user, input, id = null) {
  await journalBikeLock(q, input.bikeId, user);
  let old;
  if (id) {
    old = (
      await q.query(
        "SELECT * FROM journal_entries WHERE id=$1 AND bike_id=$2 AND owner_id=$3 FOR UPDATE",
        [id, input.bikeId, user],
      )
    ).rows[0];
    if (!old) throw new CommunityError("Запись недоступна", 404);
  } else {
    const n = (
      await q.query(
        "SELECT count(*)::int n FROM journal_entries WHERE owner_id=$1",
        [user],
      )
    ).rows[0].n;
    if (n >= 1000)
      throw new CommunityError("Лимит: 1000 записей на владельца", 409);
  }
  if (
    input.rideId &&
    !(
      await q.query(
        "SELECT id FROM rides WHERE id=$1 AND bike_id=$2 AND owner_id=$3 FOR SHARE",
        [input.rideId, input.bikeId, user],
      )
    ).rowCount
  )
    throw new CommunityError("Выберите покатушку этого велосипеда");
  // Retained references keep their original snapshot, even after component edits/deletion.
  const stored = new Map((old?.components || []).map((c) => [c.id, c]));
  const added = input.componentIds.filter((id) => !stored.has(id));
  const parts = added.length
    ? (
        await q.query(
          "SELECT * FROM components WHERE id=ANY($1::uuid[]) AND bike_id=$2 FOR SHARE",
          [added, input.bikeId],
        )
      ).rows
    : [];
  if (parts.length !== added.length)
    throw new CommunityError("Компонент не принадлежит велосипеду");
  const stamp = new Date().toISOString();
  for (const p of parts)
    stored.set(p.id, { ...publicComponent(p, true), capturedAt: stamp });
  const snapshots = input.componentIds.map((id) => stored.get(id));
  const entry = id || randomUUID(),
    share = old?.share_id || randomUUID();
  await q.query(
    `INSERT INTO journal_entries(id,share_id,owner_id,bike_id,kind,title,body,status,is_public,event_date,mileage,ride_id,components,published_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $8='published' THEN now() END)
 ON CONFLICT(id) DO UPDATE SET kind=$5,title=$6,body=$7,status=$8,is_public=$9,event_date=$10,mileage=$11,ride_id=$12,components=$13,updated_at=now(),published_at=CASE WHEN $8='published' THEN coalesce(journal_entries.published_at,now()) ELSE journal_entries.published_at END`,
    [
      entry,
      share,
      user,
      input.bikeId,
      input.kind,
      input.title,
      input.body,
      input.status,
      input.isPublic,
      input.eventDate,
      input.mileage,
      input.rideId,
      JSON.stringify(snapshots),
    ],
  );
  await q.query(
    "UPDATE journal_entries SET installation_result=$2,solution_id=CASE WHEN kind='question' THEN solution_id END WHERE id=$1",
    [entry, input.kind === "build" ? input.installationResult : null],
  );
  const published = await q.query(
    "UPDATE journal_entries e SET participation_recorded=true FROM bikes b WHERE e.id=$1 AND b.id=e.bike_id AND b.is_public AND e.is_public AND e.status='published' AND NOT e.participation_recorded RETURNING e.id",
    [entry],
  );
  if (published.rowCount) await participation(q, user, "publish");
  return { id: entry, shareId: share };
}
export async function deleteJournal(q, id, user) {
  const e = (
    await q.query(
      "SELECT bike_id FROM journal_entries WHERE id=$1 AND owner_id=$2",
      [id, user],
    )
  ).rows[0];
  if (!e) throw new CommunityError("Запись недоступна", 404);
  await journalBikeLock(q, e.bike_id, user);
  await q.query("DELETE FROM journal_entries WHERE id=$1 AND owner_id=$2", [
    id,
    user,
  ]);
  return { ok: true };
}
