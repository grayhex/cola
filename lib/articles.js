import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CommunityError } from "./community-validation.js";
import { publicAuthor } from "./profile-dto.js";
import { journalBikeLock } from "./journal.js";
import { getSite } from "./site.js";
import { entitySocial } from "./entity-social.js";
import { parseRichText, richExcerpt } from "./rich-text.js";
const text = (n) =>
  z
    .string()
    .trim()
    .max(n)
    .refine((s) => !s.includes("\0"));
/** @typedef {z.infer<typeof articleInput>} ArticleInput */
export const articleInput = z
  .object({
    title: text(160),
    body: text(20000),
    topicId: z.string().max(64),
    status: z.enum(["draft", "published"]),
  })
  .strict()
  .refine(
    (v) => v.status === "draft" || (v.title.length > 0 && v.body.length > 0),
    { message: "Для публикации нужны заголовок и текст" },
  );
export const articleSocial = entitySocial("article");
const from = " FROM journal_entries e JOIN users u ON u.id=e.owner_id";
const visible =
  "e.kind='article' AND NOT u.blocked AND ((e.status='published' AND e.is_public) OR e.owner_id=$1)";
const columns = `e.*,u.username,u.name author_name,u.avatar_id,
 (SELECT count(*)::int FROM journal_comments c JOIN users a ON a.id=c.author_id WHERE c.entry_id=e.id AND c.deleted_at IS NULL AND NOT a.blocked) comments,
 (SELECT id FROM journal_photos p WHERE p.entry_id=e.id ORDER BY p.created_at,p.id LIMIT 1) cover_id`;
function dto(e, user) {
  return {
    id: e.id,
    shareId: e.share_id,
    title: e.title,
    body: e.body,
    topicId: e.topic_id,
    status: e.status,
    isPublic: e.is_public,
    isOwner: e.owner_id === user,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
    publishedAt: e.published_at,
    comments: e.comments,
    cover: e.cover_id ? "/api/journal/media/" + e.cover_id : null,
    author: publicAuthor({
      id: e.owner_id,
      username: e.username,
      name: e.author_name,
      avatar_id: e.avatar_id,
    }),
  };
}
export async function articleList(
  q,
  user = null,
  { own = false, topic = null, page = 1, search = "" } = {},
) {
  const where = ` WHERE ${visible} AND (${own ? "e.owner_id=$1" : "e.status='published' AND e.is_public"}) AND ($2::text IS NULL OR e.topic_id=$2) AND ($3='' OR e.title ILIKE '%'||$3||'%' OR e.body ILIKE '%'||$3||'%')`;
  const params = [user, topic, search];
  const total = (await q.query("SELECT count(*)::int n" + from + where, params))
    .rows[0].n;
  const rows = (
    await q.query(
      "SELECT " +
        columns +
        from +
        where +
        " ORDER BY coalesce(e.published_at,e.created_at) DESC,e.id LIMIT 20 OFFSET $4",
      [...params, (page - 1) * 20],
    )
  ).rows;
  return {
    articles: rows.map((e) => ({
      ...dto(e, user),
      body: e.body.replace(/!\[[^\]]*\]\([^)]+\)/g, "").slice(0, 220),
      excerpt: richExcerpt(e.body, 220),
    })),
    total,
    page,
    pageSize: 20,
  };
}
export async function articleDetail(q, share, user = null) {
  const e = (
    await q.query(
      "SELECT " + columns + from + ` WHERE ${visible} AND e.share_id=$2`,
      [user, share],
    )
  ).rows[0];
  if (!e) throw new CommunityError("Статья недоступна", 404);
  const photos = (
    await q.query(
      "SELECT id FROM journal_photos WHERE entry_id=$1 ORDER BY created_at,id",
      [e.id],
    )
  ).rows.map((p) => ({ id: p.id, url: "/api/journal/media/" + p.id }));
  // Parsed here, so readers render the article without the parser (#117).
  return { ...dto(e, user), bodyDoc: parseRichText(e.body), photos };
}
/** @param {ArticleInput} input */
export async function saveArticle(q, user, input, id = null) {
  await journalBikeLock(q, null, user);
  const old = id
    ? (
        await q.query(
          "SELECT * FROM journal_entries WHERE id=$1 AND owner_id=$2 AND kind='article' FOR UPDATE",
          [id, user],
        )
      ).rows[0]
    : null;
  if (id && !old) throw new CommunityError("Статья недоступна", 404);
  const { settings } = await getSite(q);
  if (!settings.articleTopics.some((t) => t.id === input.topicId))
    throw new CommunityError("Выберите действующую рубрику");
  if (
    !id &&
    (
      await q.query(
        "SELECT count(*)::int n FROM journal_entries WHERE owner_id=$1",
        [user],
      )
    ).rows[0].n >= 1000
  )
    throw new CommunityError("Лимит: 1000 записей и статей на владельца", 409);
  const entry = id || randomUUID(),
    share = old?.share_id || randomUUID();
  await q.query(
    `INSERT INTO journal_entries(id,share_id,owner_id,bike_id,kind,title,body,status,is_public,topic_id,published_at) VALUES($1,$2,$3,NULL,'article',$4,$5,$6,$7,$8,CASE WHEN $6='published' THEN now() END)
 ON CONFLICT(id) DO UPDATE SET title=$4,body=$5,status=$6,is_public=$7,topic_id=$8,updated_at=now(),published_at=CASE WHEN $6='published' THEN coalesce(journal_entries.published_at,now()) ELSE journal_entries.published_at END`,
    [
      entry,
      share,
      user,
      input.title,
      input.body,
      input.status,
      input.status === "published",
      input.topicId,
    ],
  );
  return { id: entry, shareId: share };
}
export async function deleteArticle(q, id, user) {
  await journalBikeLock(q, null, user);
  if (
    !(
      await q.query(
        "DELETE FROM journal_entries WHERE id=$1 AND owner_id=$2 AND kind='article'",
        [id, user],
      )
    ).rowCount
  )
    throw new CommunityError("Статья недоступна", 404);
  return { ok: true };
}
