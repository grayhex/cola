import type { Queryable } from "./db.ts";
import type { ClubRole, ClubState } from "./club-contracts.ts";
import { CommunityError } from "./community-validation.ts";
import { EmailPolicyError } from "./email-policy.ts";
export const clubPostPublic = `p.status='published' AND p.hidden_at IS NULL AND p.deleted_at IS NULL AND NOT author.blocked AND c.hidden_at IS NULL AND (c.owner_id IS NULL OR NOT co.blocked)`;
export const clubPostFrom = `FROM club_posts p JOIN clubs c ON c.id=p.club_id JOIN users author ON author.id=p.owner_id LEFT JOIN users co ON co.id=c.owner_id`;
export interface ClubPostActorAccess {
  id: string;
  club_id: string;
  owner_id: string;
  club_owner: string | null;
  archived_at: Date | null;
  hidden_at: Date | null;
  deleted_at: Date | null;
  status: "draft" | "published";
  version: number;
  role: ClubRole | null;
  state: ClubState | null;
  site_role: "user" | "admin";
  verified: boolean;
}
// Mutations lock every user first (including the current club owner), then
// club/post. A changed owner makes the caller retry rather than lock out of order.
export async function lockClubPostActor(
  q: Queryable,
  club: string,
  post: string | null,
  actor: string,
  others: string[] = [],
  { published = false, withdraw = false, withdrawOwn = false } = {},
) {
  const initial = (
    await q.query<{ owner_id: string | null; post_owner: string | null }>(
      `SELECT c.owner_id,p.owner_id post_owner FROM clubs c LEFT JOIN club_posts p ON p.club_id=c.id AND p.id=$2 WHERE c.id=$1`,
      [club, post],
    )
  ).rows[0];
  if (!initial || (post && !initial.post_owner))
    throw new CommunityError("Публикация недоступна", 404);
  const ids = [
    ...new Set(
      [actor, initial.owner_id, initial.post_owner, ...others].filter(
        (v): v is string => !!v,
      ),
    ),
  ];
  const users = (
    await q.query<{
      id: string;
      blocked: boolean;
      email_verified_at: Date | null;
      role: "user" | "admin";
    }>(
      "SELECT id,blocked,email_verified_at,role FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [ids],
    )
  ).rows;
  const user = users.find((u) => u.id === actor);
  if (!user || user.blocked)
    throw new CommunityError("Аккаунт недоступен", 403);
  const c = (
    await q.query<{
      owner_id: string | null;
      archived_at: Date | null;
      hidden_at: Date | null;
    }>(
      "SELECT owner_id,archived_at,hidden_at FROM clubs WHERE id=$1 FOR UPDATE",
      [club],
    )
  ).rows[0];
  if (!c || c.owner_id !== initial.owner_id)
    throw new CommunityError("Клуб изменён. Обновите страницу.", 409);
  const p = post
    ? (
        await q.query<{
          owner_id: string;
          hidden_at: Date | null;
          deleted_at: Date | null;
          status: "draft" | "published";
          version: number;
        }>(
          "SELECT owner_id,hidden_at,deleted_at,status,version FROM club_posts WHERE id=$1 AND club_id=$2 FOR UPDATE",
          [post, club],
        )
      ).rows[0]
    : null;
  if (post && !p) throw new CommunityError("Публикация недоступна", 404);
  const m = (
    await q.query<{ role: ClubRole; state: ClubState }>(
      "SELECT role,state FROM club_memberships WHERE club_id=$1 AND user_id=$2",
      [club, actor],
    )
  ).rows[0];
  const own = p?.owner_id === actor,
    siteAdmin = user.role === "admin";
  if (!withdraw || (!own && !siteAdmin && !withdrawOwn)) {
    const clubOwner = users.find((u) => u.id === c.owner_id);
    if (c.hidden_at || clubOwner?.blocked)
      throw new CommunityError("Клуб недоступен", 404);
    if (c.archived_at) throw new CommunityError("Клуб в архиве", 409);
    if (!siteAdmin && m?.state !== "active")
      throw new CommunityError("Действие доступно участникам клуба", 403);
    if (p?.hidden_at || p?.deleted_at)
      throw new CommunityError("Публикация недоступна", 404);
  }
  if (published && !user.email_verified_at) throw new EmailPolicyError();
  // Site moderation grants deletion, not publishing membership or other people's drafts.
  if (!withdraw && m?.state !== "active")
    throw new CommunityError("Действие доступно участникам клуба", 403);
  return {
    id: post || "",
    club_id: club,
    owner_id: p?.owner_id || actor,
    club_owner: c.owner_id,
    archived_at: c.archived_at,
    hidden_at: p?.hidden_at || null,
    deleted_at: p?.deleted_at || null,
    status: p?.status || "draft",
    version: p?.version || 0,
    role: m?.role || null,
    state: m?.state || null,
    site_role: user.role,
    verified: !!user.email_verified_at,
  } satisfies ClubPostActorAccess;
}
export async function publicClubPost(q: Queryable, id: string) {
  const row = (
    await q.query<{ id: string; club_id: string; owner_id: string }>(
      `SELECT p.id,p.club_id,p.owner_id ${clubPostFrom} WHERE p.id=$1 AND ${clubPostPublic}`,
      [id],
    )
  ).rows[0];
  if (!row) throw new CommunityError("Публикация недоступна", 404);
  return row;
}
