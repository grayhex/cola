import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Queryable } from "./db.ts";
import type { ClubRole, ClubState } from "./club-contracts.ts";
import { uuid } from "./validation.ts";
import { CommunityError } from "./community-validation.ts";
import { clubPostFrom, lockClubPostActor } from "./club-post-access.ts";
import { publicAuthor } from "./profile-dto.ts";
import { parseRichText, richExcerpt } from "./rich-text.ts";
import { clubDetail, clubAudit } from "./clubs.ts";
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !s.includes("\0"));
export const clubPostInput = z
  .object({
    title: text(160).default(""),
    body: text(20000).default(""),
    status: z.enum(["draft", "published"]).default("draft"),
  })
  .strict();
export const clubPostCreateInput = clubPostInput
  .extend({ requestId: uuid })
  .strict();
export const clubPostEditInput = clubPostInput
  .extend({ version: z.number().int().positive() })
  .strict();
export const clubPostModerationInput = z
  .object({
    action: z.enum(["pin", "unpin", "hide"]),
    version: z.number().int().positive(),
  })
  .strict();
export const clubPostPath = (club: string, post: string) =>
  "/clubs/" + club + "/posts/" + post;
export const clubPostPhotoPath = (club: string, post: string, photo: string) =>
  "/api/clubs/" + club + "/posts/" + post + "/media/" + photo;
interface PostRow {
  id: string;
  club_id: string;
  club_name: string;
  owner_id: string;
  title: string;
  body: string;
  status: "draft" | "published";
  pinned: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
  username: string;
  author_name: string;
  avatar_id: string | null;
  comments: number;
  likes: number;
  liked: boolean;
  archived_at: Date | null;
  member_role: ClubRole | null;
  member_state: ClubState | null;
  verified: boolean;
  viewer_site_role: "user" | "admin" | null;
  photos: { id: string }[];
}
const columns = `p.*,c.name club_name,c.archived_at,author.username,author.name author_name,author.avatar_id,m.role member_role,m.state member_state,v.email_verified_at IS NOT NULL verified,v.role viewer_site_role,
 (SELECT count(*)::int FROM club_post_comments comment JOIN users u ON u.id=comment.author_id WHERE comment.post_id=p.id AND comment.deleted_at IS NULL AND NOT u.blocked) comments,
 (SELECT count(*)::int FROM club_post_likes l JOIN users u ON u.id=l.user_id WHERE l.post_id=p.id AND NOT u.blocked) likes,
 EXISTS(SELECT 1 FROM club_post_likes WHERE post_id=p.id AND user_id=$2) liked,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('id',photo.id) ORDER BY photo.created_at,photo.id),'[]') FROM club_post_photos photo WHERE photo.post_id=p.id) photos`;
const from =
  clubPostFrom +
  ` LEFT JOIN users v ON v.id=$2 AND NOT v.blocked LEFT JOIN club_memberships m ON m.club_id=c.id AND m.user_id=v.id`;
const readable = `p.deleted_at IS NULL AND p.hidden_at IS NULL AND NOT author.blocked AND c.hidden_at IS NULL AND (c.owner_id IS NULL OR NOT co.blocked) AND (p.status='published' OR p.owner_id=$2 AND v.id IS NOT NULL)`;
function dto(p: PostRow, viewer: string | null) {
  const active = p.member_state === "active" && !p.archived_at,
    own = p.owner_id === viewer,
    moderator = active && ["owner", "admin"].includes(p.member_role || "");
  return {
    id: p.id,
    viewerId: viewer,
    club: { id: p.club_id, name: p.club_name },
    title: p.title,
    body: p.body,
    bodyDoc: parseRichText(p.body),
    excerpt: richExcerpt(p.body, 220),
    status: p.status,
    pinned: p.pinned,
    version: p.version,
    createdAt: p.created_at.toISOString(),
    updatedAt: p.updated_at.toISOString(),
    publishedAt: p.published_at?.toISOString() || null,
    author: publicAuthor({
      id: p.owner_id,
      username: p.username,
      name: p.author_name,
      avatar_id: p.avatar_id,
    }),
    comments: p.comments,
    likes: p.likes,
    liked: p.liked,
    photos: p.photos.map((photo) => ({
      id: photo.id,
      url: clubPostPhotoPath(p.club_id, p.id, photo.id),
    })),
    href: clubPostPath(p.club_id, p.id),
    isOwner: own,
    canEdit: own && active,
    canDelete: own || moderator || p.viewer_site_role === "admin",
    canModerate: moderator,
    canModerateComments: moderator || p.viewer_site_role === "admin",
    canParticipate: active && p.verified,
  };
}
export async function clubPostDetail(
  q: Queryable,
  club: string,
  id: string,
  viewer: string | null = null,
) {
  const p = (
    await q.query<PostRow>(
      `SELECT ${columns} ${from} WHERE p.club_id=$1 AND p.id=$3 AND ${readable}`,
      [club, viewer, id],
    )
  ).rows[0];
  if (!p) throw new CommunityError("Публикация недоступна", 404);
  return dto(p, viewer);
}
export async function clubPostList(
  q: Queryable,
  club: string,
  viewer: string | null,
  { page = 1, own = false } = {},
) {
  z.number().int().min(1).max(10000).parse(page);
  await clubDetail(q, club, viewer);
  if (own && !viewer) throw new CommunityError("Войдите в аккаунт", 401);
  const pinned = !own
    ? (
        await q.query<PostRow>(
          `SELECT ${columns} ${from} WHERE p.club_id=$1 AND ${readable} AND p.status='published' AND p.pinned LIMIT 1`,
          [club, viewer],
        )
      ).rows[0]
    : null;
  const rows = (
    await q.query<PostRow>(
      `SELECT ${columns} ${from} WHERE p.club_id=$1 AND ${readable} AND ${own ? "p.owner_id=$2" : "p.status='published' AND NOT p.pinned"} ORDER BY coalesce(p.published_at,p.created_at) DESC,p.id DESC LIMIT 21 OFFSET $3`,
      [club, viewer, (page - 1) * 20],
    )
  ).rows;
  return {
    pinned: pinned ? dto(pinned, viewer) : null,
    posts: rows.slice(0, 20).map((p) => dto(p, viewer)),
    hasMore: rows.length > 20,
    page,
  };
}
export async function postByRequest(
  q: Queryable,
  club: string,
  actor: string,
  request: string,
) {
  const row = (
    await q.query<{ post_id: string }>(
      "SELECT r.post_id FROM club_post_create_requests r JOIN club_posts p ON p.id=r.post_id WHERE r.user_id=$1 AND r.request_id=$2 AND p.club_id=$3",
      [actor, request, club],
    )
  ).rows[0];
  return row ? clubPostDetail(q, club, row.post_id, actor) : null;
}
async function publishable(q: Queryable, id: string, body: string) {
  if (
    !body &&
    !(
      await q.query("SELECT 1 FROM club_post_photos WHERE post_id=$1 LIMIT 1", [
        id,
      ])
    ).rowCount
  )
    throw new CommunityError("Для публикации добавьте текст или фотографию");
}
export async function createClubPost(
  q: Queryable,
  club: string,
  actor: string,
  raw: z.infer<typeof clubPostCreateInput>,
) {
  const input = clubPostCreateInput.parse(raw);
  await lockClubPostActor(q, club, null, actor, [], {
    published: input.status === "published",
  });
  const hash = createHash("sha256")
    .update(JSON.stringify({ club, ...input }))
    .digest("hex");
  const previous = (
    await q.query<{ post_id: string; input_hash: string }>(
      "SELECT post_id,input_hash FROM club_post_create_requests WHERE user_id=$1 AND request_id=$2",
      [actor, input.requestId],
    )
  ).rows[0];
  if (previous) {
    if (previous.input_hash !== hash)
      throw new CommunityError(
        "Запрос уже использован. Откройте сохранённый черновик.",
        409,
      );
    return clubPostDetail(q, club, previous.post_id, actor);
  }
  const id = randomUUID();
  if (input.status === "published") await publishable(q, id, input.body);
  await q.query(
    `INSERT INTO club_posts(id,club_id,owner_id,title,body,status,published_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $6='published' THEN now() ELSE NULL END)`,
    [id, club, actor, input.title, input.body, input.status],
  );
  await q.query(
    "INSERT INTO club_post_create_requests(user_id,request_id,post_id,input_hash) VALUES($1,$2,$3,$4)",
    [actor, input.requestId, id, hash],
  );
  return clubPostDetail(q, club, id, actor);
}
export async function editClubPost(
  q: Queryable,
  club: string,
  id: string,
  actor: string,
  raw: z.infer<typeof clubPostEditInput>,
) {
  const input = clubPostEditInput.parse(raw),
    p = await lockClubPostActor(q, club, id, actor, [], {
      published: input.status === "published",
    });
  if (p.owner_id !== actor)
    throw new CommunityError(
      "Редактировать публикацию может только автор",
      403,
    );
  if (p.version !== input.version)
    throw new CommunityError(
      "Публикация уже изменена. Обновите страницу.",
      409,
    );
  if (input.status === "published") await publishable(q, id, input.body);
  await q.query(
    `UPDATE club_posts SET title=$2,body=$3,status=$4,pinned=CASE WHEN $4='draft' THEN false ELSE pinned END,published_at=CASE WHEN $4='published' THEN coalesce(published_at,now()) ELSE published_at END,version=version+1,updated_at=now() WHERE id=$1`,
    [id, input.title, input.body, input.status],
  );
  return clubPostDetail(q, club, id, actor);
}
export async function deleteClubPost(
  q: Queryable,
  club: string,
  id: string,
  actor: string,
) {
  const p = await lockClubPostActor(q, club, id, actor, [], { withdraw: true });
  if (
    p.owner_id !== actor &&
    p.site_role !== "admin" &&
    !(p.state === "active" && ["owner", "admin"].includes(p.role || ""))
  )
    throw new CommunityError("Недостаточно прав", 403);
  if (p.status === "draft" && p.owner_id !== actor)
    throw new CommunityError("Черновик доступен только автору", 404);
  await q.query(
    "UPDATE club_posts SET deleted_at=coalesce(deleted_at,now()),body='',title='',pinned=false,version=version+1,updated_at=now() WHERE id=$1",
    [id],
  );
  await q.query("DELETE FROM club_post_photos WHERE post_id=$1", [id]);
  return { ok: true };
}
export async function moderateClubPost(
  q: Queryable,
  club: string,
  id: string,
  actor: string,
  raw: z.infer<typeof clubPostModerationInput>,
) {
  const input = clubPostModerationInput.parse(raw),
    p = await lockClubPostActor(q, club, id, actor);
  if (p.state !== "active" || !["owner", "admin"].includes(p.role || ""))
    throw new CommunityError("Модерация доступна администрации клуба", 403);
  if (p.version !== input.version)
    throw new CommunityError(
      "Публикация уже изменена. Обновите страницу.",
      409,
    );
  if (p.status !== "published")
    throw new CommunityError("Черновики не модерируются этим действием", 403);
  if (input.action === "pin")
    await q.query(
      "UPDATE club_posts SET pinned=false,version=version+1 WHERE club_id=$1 AND pinned",
      [club],
    );
  await q.query(
    `UPDATE club_posts SET pinned=$2,hidden_at=CASE WHEN $3 THEN now() ELSE hidden_at END,version=version+1,updated_at=now() WHERE id=$1`,
    [id, input.action === "pin", input.action === "hide"],
  );
  await clubAudit(q, club, actor, "post_" + input.action, p.owner_id);
  return { ok: true };
}
export type ClubPostDto = Awaited<ReturnType<typeof clubPostDetail>>;
