import type { Queryable } from "./db.ts";
import { RideError } from "./ride-gpx.ts";
import { EmailPolicyError } from "./email-policy.ts";
import type { ClubRole } from "./club-contracts.ts";
// Application-owned aliases/references only. All callers still apply bicycle,
// author, public/invitation and RSVP precision rules after this envelope.
type Alias = "r" | "rr" | "row" | "target" | "candidate";
type ViewerRef = `$${number}` | "n.recipient_id" | "v.user_id";
const available = (alias: Alias) =>
  `EXISTS(SELECT 1 FROM clubs club LEFT JOIN users co ON co.id=club.owner_id WHERE club.id=${alias}.club_id AND club.hidden_at IS NULL AND (club.owner_id IS NULL OR NOT co.blocked) AND EXISTS(SELECT 1 FROM bikes cb WHERE cb.id=${alias}.bike_id AND cb.owner_id=${alias}.owner_id AND (${alias}.status<>'planned' OR (${alias}.recurrence='none' AND ${alias}.started_at<=now()) OR NOT cb.is_former) AND EXISTS(SELECT 1 FROM users creator WHERE creator.id=${alias}.owner_id AND NOT creator.blocked)))`;
export const publicClubRideSql = (alias: Alias = "r") =>
  `(${alias}.club_id IS NULL OR (${alias}.club_audience='open' AND ${available(alias)}))`;
export const clubRideEnvelopeSql = (viewer: ViewerRef, alias: Alias = "r") =>
  `(${alias}.club_id IS NULL OR (${available(alias)} AND (${alias}.club_audience='open' OR EXISTS(SELECT 1 FROM club_memberships cm JOIN users cv ON cv.id=cm.user_id WHERE cm.club_id=${alias}.club_id AND cm.user_id=${viewer} AND cm.state='active' AND NOT cv.blocked))))`;
export const internalClubRideSql = (viewer: ViewerRef, alias: Alias = "r") =>
  `(${alias}.club_id IS NOT NULL AND ${alias}.club_audience='members' AND ${clubRideEnvelopeSql(viewer, alias)})`;
export const clubRideWritableSql = (viewer: ViewerRef, alias: Alias = "r") =>
  `(${alias}.club_id IS NULL OR EXISTS(SELECT 1 FROM clubs club JOIN users co ON co.id=club.owner_id JOIN club_memberships cm ON cm.club_id=club.id AND cm.user_id=${viewer} JOIN users cv ON cv.id=cm.user_id WHERE club.id=${alias}.club_id AND club.hidden_at IS NULL AND club.archived_at IS NULL AND NOT co.blocked AND NOT cv.blocked AND cm.state='active' AND cm.role IN ('owner','admin','organizer')))`;

// Lock order shared with membership/ownership changes: every known user sorted,
// then club, then the caller's bicycle and ride. Do not lock another user later
// if the club owner changed between the initial lookup and the lock.
export async function lockRideClub(
  q: Queryable,
  club: string,
  actor: string,
  {
    organizer = true,
    verified = true,
    membershipRequired = true,
    others = [],
  }: {
    organizer?: boolean;
    verified?: boolean;
    membershipRequired?: boolean;
    others?: string[];
  } = {},
) {
  const before = (
    await q.query<{ owner_id: string | null }>(
      "SELECT owner_id FROM clubs WHERE id=$1",
      [club],
    )
  ).rows[0];
  if (!before) throw new RideError("Клуб недоступен", 404);
  const people = (
    await q.query<{
      id: string;
      blocked: boolean;
      email_verified_at: Date | null;
    }>(
      "SELECT id,blocked,email_verified_at FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [
        [
          ...new Set(
            [actor, before.owner_id, ...others].filter(
              (id): id is string => !!id,
            ),
          ),
        ],
      ],
    )
  ).rows;
  const user = people.find((p) => p.id === actor);
  if (!user || user.blocked)
    throw new RideError("Пользователь недоступен", 403);
  if (verified && !user.email_verified_at) throw new EmailPolicyError();
  const c = (
    await q.query<{
      owner_id: string | null;
      hidden_at: Date | null;
      archived_at: Date | null;
    }>(
      "SELECT owner_id,hidden_at,archived_at FROM clubs WHERE id=$1 FOR UPDATE",
      [club],
    )
  ).rows[0];
  if (!c || c.owner_id !== before.owner_id)
    throw new RideError("Клуб изменился. Обновите страницу.", 409);
  if (c.hidden_at || people.find((p) => p.id === c.owner_id)?.blocked)
    throw new RideError("Клуб недоступен", 404);
  if (c.archived_at) throw new RideError("Клуб в архиве", 409);
  const member = (
    await q.query<{ role: ClubRole; state: string }>(
      "SELECT role,state FROM club_memberships WHERE club_id=$1 AND user_id=$2",
      [club, actor],
    )
  ).rows[0];
  if (
    (membershipRequired && member?.state !== "active") ||
    (organizer &&
      (member?.state !== "active" ||
        !["owner", "admin", "organizer"].includes(member?.role || "")))
  )
    throw new RideError(
      organizer
        ? "Выезды создают владельцы, администраторы и организаторы клуба"
        : "Внутренний выезд доступен участникам клуба",
      403,
    );
  return { id: club, role: member?.role || null };
}
export async function lockOwnRideClub(
  q: Queryable,
  id: string,
  actor: string,
  {
    verified = true,
    others = [],
  }: { verified?: boolean; others?: string[] } = {},
) {
  const row = (
    await q.query<{
      club_id: string | null;
      owner_id: string;
      club_audience: "members" | "open" | null;
    }>(
      "SELECT club_id,owner_id,club_audience FROM rides WHERE id=$1 AND owner_id=$2",
      [id, actor],
    )
  ).rows[0];
  if (!row) throw new RideError("Покатушка недоступна", 404);
  if (row.club_id)
    await lockRideClub(q, row.club_id, actor, { verified, others });
  return row;
}
