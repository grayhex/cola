import { z } from "zod";
import type { Queryable } from "./db.ts";
import type { ClubBadgesDto, ClubBadgeDto } from "./club-contracts.ts";
import { uuid } from "./validation.ts";
import { CommunityError } from "./community-validation.ts";
import { clubMediaPath, clubPath, lockClubActor } from "./clubs.ts";
export const badgePreferencesInput = z
  .object({
    clubs: z
      .array(z.object({ id: uuid, visible: z.boolean() }).strict())
      .max(1000)
      .refine((a) => new Set(a.map((c) => c.id)).size === a.length),
  })
  .strict();
const available = `m.state='active' AND NOT u.blocked AND c.archived_at IS NULL AND c.hidden_at IS NULL AND NOT o.blocked`;
interface BadgeRow {
  user_id: string;
  id: string;
  name: string;
  logo_id: string | null;
  total: number;
}
const dto = (r: BadgeRow): ClubBadgeDto => ({
  id: r.id,
  name: r.name,
  logo: r.logo_id ? clubMediaPath(r.id, r.logo_id) : null,
  href: clubPath(r.id),
});
// One query for any number of owners; bounded 20 badges per owner plus a truthful
// count. Expanding a shelf fetches public pages, never hidden membership.
export async function publicClubBadges(
  q: Queryable,
  users: string[],
  page = 1,
): Promise<Map<string, ClubBadgesDto>> {
  z.number().int().min(1).max(10000).parse(page);
  const result = new Map<string, ClubBadgesDto>();
  for (const id of users) result.set(id, { items: [], total: 0 });
  if (!users.length) return result;
  const rows = (
    await q.query<BadgeRow>(
      `WITH badges AS (
 SELECT m.user_id,c.id,c.name,c.logo_id,count(*) OVER(PARTITION BY m.user_id)::int total,
 row_number() OVER(PARTITION BY m.user_id ORDER BY m.badge_order,c.created_at,c.id) position
 FROM club_memberships m JOIN users u ON u.id=m.user_id JOIN clubs c ON c.id=m.club_id JOIN users o ON o.id=c.owner_id
 WHERE m.user_id=ANY($1::uuid[]) AND ${available} AND m.badge_visible)
 SELECT user_id,id,name,logo_id,total FROM badges WHERE position>$2 AND position<=$3 ORDER BY user_id,position`,
      [users, (page - 1) * 20, page * 20],
    )
  ).rows;
  for (const row of rows) {
    const existing = result.get(row.user_id);
    if (existing) {
      existing.items.push(dto(row));
      existing.total = row.total;
    }
  }
  return result;
}
export async function ownBadgePreferences(q: Queryable, user: string) {
  const rows = (
    await q.query<BadgeRow & { badge_visible: boolean }>(
      `SELECT m.user_id,c.id,c.name,c.logo_id,m.badge_visible,0 total
 FROM club_memberships m JOIN users u ON u.id=m.user_id JOIN clubs c ON c.id=m.club_id JOIN users o ON o.id=c.owner_id
 WHERE m.user_id=$1 AND ${available} ORDER BY m.badge_order,c.created_at,c.id LIMIT 1000`,
      [user],
    )
  ).rows;
  return { clubs: rows.map((r) => ({ ...dto(r), visible: r.badge_visible })) };
}
export async function saveBadgePreferences(
  q: Queryable,
  user: string,
  raw: z.infer<typeof badgePreferencesInput>,
) {
  const input = badgePreferencesInput.parse(raw);
  await lockClubActor(q, user, false);
  const ids = input.clubs.map((c) => c.id);
  const allowed = (
    await q.query<{ club_id: string }>(
      `SELECT m.club_id FROM club_memberships m JOIN users u ON u.id=m.user_id JOIN clubs c ON c.id=m.club_id JOIN users o ON o.id=c.owner_id WHERE m.user_id=$1 AND m.club_id=ANY($2::uuid[]) AND ${available} ORDER BY m.club_id FOR UPDATE OF m`,
      [user, ids],
    )
  ).rows;
  if (allowed.length !== ids.length)
    throw new CommunityError(
      "Состав клубов изменился. Обновите настройки.",
      409,
    );
  await q.query(
    `UPDATE club_memberships m SET badge_visible=p.visible,badge_order=p.position FROM
 (SELECT unnest($2::uuid[]) club_id,unnest($3::boolean[]) visible,generate_subscripts($2::uuid[],1)-1 position) p
 WHERE m.user_id=$1 AND m.club_id=p.club_id`,
    [user, ids, input.clubs.map((c) => c.visible)],
  );
  return ownBadgePreferences(q, user);
}
// Closed SQL expressions only. The owner list uses $1 as an initplan, so the
// aggregate is evaluated once for a batch of bikes, without another DB roundtrip.
export function publicClubBadgesSql(owner: "users.id" | "$1::uuid") {
  return `(SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('id',badge.id,'name',badge.name,'logo',CASE WHEN badge.logo_id IS NULL THEN NULL ELSE '/api/clubs/'||badge.id::text||'/media/'||badge.logo_id::text END,'href','/clubs/'||badge.id::text) ORDER BY badge.position),'[]'::jsonb),'total',coalesce(max(badge.total),0)) FROM (
 SELECT c.id,c.name,c.logo_id,count(*) OVER()::int total,row_number() OVER(ORDER BY m.badge_order,c.created_at,c.id) position
 FROM club_memberships m JOIN users u ON u.id=m.user_id JOIN clubs c ON c.id=m.club_id JOIN users o ON o.id=c.owner_id
 WHERE m.user_id=${owner} AND ${available} AND m.badge_visible ORDER BY m.badge_order,c.created_at,c.id LIMIT 20) badge)`;
}
