import { z } from "zod";
import type { Queryable } from "./db.ts";
import type { ClubRole, ClubState } from "./club-contracts.ts";
import { uuid } from "./validation.ts";
import { CommunityError } from "./community-validation.ts";
import { EmailPolicyError } from "./email-policy.ts";
import { clubAudit, clubDetail, clubEligibility } from "./clubs.ts";
import { publicAuthor } from "./profile-dto.ts";
export const membershipActionInput = z
  .object({
    action: z.enum([
      "join",
      "cancel",
      "accept-invite",
      "decline-invite",
      "leave",
    ]),
  })
  .strict();
export const memberManagementInput = z
  .object({
    action: z.enum([
      "approve",
      "reject",
      "invite",
      "revoke-invite",
      "exclude",
      "block",
      "unblock",
      "role",
    ]),
    role: z.enum(["admin", "organizer", "member"]).optional(),
  })
  .strict()
  .refine((v) => (v.action === "role" ? !!v.role : v.role === undefined));
export const transferInput = z
  .object({
    action: z.enum(["offer", "cancel", "accept", "decline"]),
    targetId: uuid.optional(),
    version: z.number().int().positive(),
  })
  .strict()
  .refine((v) =>
    v.action === "offer" ? !!v.targetId : v.targetId === undefined,
  );
interface Membership {
  user_id: string;
  role: ClubRole;
  state: ClubState;
  revision: number;
  invite_expires_at: Date | null;
  badge_visible: boolean;
  badge_order: number;
}
interface LockedClub {
  id: string;
  owner_id: string;
  archived_at: Date | null;
  join_mode: "application" | "open";
  members_visibility: "public" | "members";
  version: number;
  transfer_user_id: string | null;
  transfer_expires_at: Date | null;
  transfer_revision: number;
}
// All multi-user operations follow the same order as blocks/social actions:
// users sorted by UUID, then club. A transfer never takes another user lock after a club lock.
async function lockPeople(
  q: Queryable,
  actor: string,
  others: string[] = [],
  verified = true,
) {
  const people = (
    await q.query<{
      id: string;
      blocked: boolean;
      email_verified_at: Date | null;
    }>(
      "SELECT id,blocked,email_verified_at FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[...new Set([actor, ...others])]],
    )
  ).rows;
  const user = people.find((p) => p.id === actor);
  if (!user || user.blocked)
    throw new CommunityError("Аккаунт недоступен", 403);
  if (verified && !user.email_verified_at) throw new EmailPolicyError();
  return people;
}
async function lockClub(q: Queryable, id: string, withdrawal = false) {
  const c = (
    await q.query<LockedClub>(
      `SELECT c.* FROM clubs c JOIN users o ON o.id=c.owner_id WHERE c.id=$1 AND c.hidden_at IS NULL AND NOT o.blocked FOR UPDATE OF c`,
      [id],
    )
  ).rows[0];
  if (!c) throw new CommunityError("Клуб недоступен", 404);
  if (c.archived_at && !withdrawal)
    throw new CommunityError("Клуб в архиве", 409);
  return c;
}
const member = async (q: Queryable, id: string, user: string) =>
  (
    await q.query<Membership>(
      "SELECT * FROM club_memberships WHERE club_id=$1 AND user_id=$2",
      [id, user],
    )
  ).rows[0];
const administrative = (m: Membership | undefined) =>
  m?.state === "active" && ["owner", "admin"].includes(m.role);
async function state(
  q: Queryable,
  id: string,
  user: string,
  next: ClubState,
  role: ClubRole = "member",
) {
  await q.query(
    `INSERT INTO club_memberships(club_id,user_id,state,role,invite_expires_at) VALUES($1,$2,$3,$4,CASE WHEN $3='invited' THEN now()+interval '7 days' ELSE NULL END)
 ON CONFLICT(club_id,user_id) DO UPDATE SET state=EXCLUDED.state,role=EXCLUDED.role,invite_expires_at=EXCLUDED.invite_expires_at,revision=club_memberships.revision+1,updated_at=now()`,
    [id, user, next, role],
  );
}
export async function changeMembership(
  q: Queryable,
  id: string,
  user: string,
  raw: z.infer<typeof membershipActionInput>,
) {
  const { action } = membershipActionInput.parse(raw);
  await lockPeople(
    q,
    user,
    [],
    action === "join" || action === "accept-invite",
  );
  const c = await lockClub(q, id, action === "leave"),
    m = await member(q, id, user);
  if (m?.state === "blocked")
    throw new CommunityError("Действие недоступно в этом клубе", 403);
  if (action === "join") {
    if (m?.state === "active" || m?.state === "pending")
      return clubDetail(q, id, user);
    if (
      m?.state === "invited" &&
      m.invite_expires_at &&
      m.invite_expires_at > new Date()
    )
      throw new CommunityError(
        "Сначала примите или отклоните приглашение",
        409,
      );
    await state(q, id, user, c.join_mode === "open" ? "active" : "pending");
  } else if (action === "cancel") {
    if (m?.state !== "pending") return clubDetail(q, id, user);
    await state(q, id, user, "left");
  } else if (action === "accept-invite") {
    if (m?.state === "active") return clubDetail(q, id, user);
    if (
      m?.state !== "invited" ||
      !m.invite_expires_at ||
      m.invite_expires_at <= new Date()
    )
      throw new CommunityError("Приглашение истекло или отозвано", 409);
    await state(q, id, user, "active");
  } else if (action === "decline-invite") {
    if (m?.state !== "invited") return clubDetail(q, id, user);
    await state(q, id, user, "left");
  } else if (action === "leave") {
    if (m?.state !== "active") return clubDetail(q, id, user);
    if (m.role === "owner" || c.owner_id === user)
      throw new CommunityError(
        "Сначала передайте владение или архивируйте клуб",
        409,
      );
    await state(q, id, user, "left");
  }
  await clubAudit(q, id, user, "membership_" + action.replaceAll("-", "_"));
  return clubDetail(q, id, user);
}
export async function manageClubMember(
  q: Queryable,
  id: string,
  actor: string,
  target: string,
  raw: z.infer<typeof memberManagementInput>,
) {
  const input = memberManagementInput.parse(raw),
    people = await lockPeople(q, actor, [target]);
  const c = await lockClub(q, id),
    a = await member(q, id, actor),
    m = await member(q, id, target),
    person = people.find((p) => p.id === target);
  if (!administrative(a))
    throw new CommunityError("Управление доступно администрации клуба", 403);
  if (!person || person.blocked)
    throw new CommunityError("Участник недоступен", 404);
  if (actor === target || target === c.owner_id || m?.role === "owner")
    throw new CommunityError(
      "Для себя или владельца используйте передачу владения и выход",
      403,
    );
  if (a?.role !== "owner" && m?.state === "active" && m.role === "admin")
    throw new CommunityError(
      "Администратор не меняет права другого администратора",
      403,
    );
  if (input.action === "approve") {
    if (!person.email_verified_at)
      throw new CommunityError(
        "Участник должен подтвердить почту перед одобрением заявки",
        403,
      );
    if (m?.state === "active") return clubDetail(q, id, actor);
    if (m?.state !== "pending")
      throw new CommunityError("Действующей заявки нет", 409);
    await state(q, id, target, "active");
  } else if (input.action === "reject") {
    if (m?.state !== "pending") return clubDetail(q, id, actor);
    await state(q, id, target, "left");
  } else if (input.action === "invite") {
    if (m?.state === "blocked")
      throw new CommunityError("Сначала снимите клубную блокировку", 409);
    if (m?.state === "active") return clubDetail(q, id, actor);
    if (
      m?.state === "invited" &&
      m.invite_expires_at &&
      m.invite_expires_at > new Date()
    )
      return clubDetail(q, id, actor);
    await state(q, id, target, "invited");
  } else if (input.action === "revoke-invite") {
    if (m?.state !== "invited") return clubDetail(q, id, actor);
    await state(q, id, target, "left");
  } else if (input.action === "exclude" || input.action === "block") {
    if (!m) throw new CommunityError("Участник недоступен", 404);
    const next = input.action === "block" ? "blocked" : "excluded";
    if (m.state === next) return clubDetail(q, id, actor);
    await state(q, id, target, next);
  } else if (input.action === "unblock") {
    if (m?.state !== "blocked") return clubDetail(q, id, actor);
    await state(q, id, target, "excluded");
  } else if (input.action === "role") {
    if (m?.state !== "active" || !input.role)
      throw new CommunityError("Роль меняют у действующего участника", 409);
    if (input.role === "admin" && a?.role !== "owner")
      throw new CommunityError("Администраторов назначает владелец", 403);
    if (m.role === input.role) return clubDetail(q, id, actor);
    await state(q, id, target, "active", input.role);
  }
  await clubAudit(
    q,
    id,
    actor,
    input.action === "role"
      ? "member_role_" + input.role
      : "member_" + input.action.replaceAll("-", "_"),
    target,
  );
  return clubDetail(q, id, actor);
}
export async function clubMembers(
  q: Queryable,
  id: string,
  viewer: string | null,
  page = 1,
  management = false,
) {
  z.number().int().min(1).max(10000).parse(page);
  const c = await clubDetail(q, id, viewer);
  if (management && !c.canManage)
    throw new CommunityError("Управление доступно администрации клуба", 403);
  if (
    !management &&
    c.membersVisibility === "members" &&
    c.membership?.state !== "active"
  )
    throw new CommunityError("Состав доступен участникам клуба", 403);
  const rows = (
    await q.query<
      Membership & {
        id: string;
        username: string;
        name: string;
        avatar_id: string | null;
        invite_live: boolean;
      }
    >(
      `SELECT m.*,u.id,u.username,u.name,u.avatar_id,m.invite_expires_at>now() invite_live FROM club_memberships m JOIN users u ON u.id=m.user_id WHERE m.club_id=$1 AND NOT u.blocked AND ($2 OR m.state='active') AND EXISTS(SELECT 1 FROM clubs c LEFT JOIN users co ON co.id=c.owner_id WHERE c.id=m.club_id AND c.hidden_at IS NULL AND (c.owner_id IS NULL OR NOT co.blocked) AND (($2 AND c.archived_at IS NULL AND EXISTS(SELECT 1 FROM club_memberships viewer JOIN users v ON v.id=viewer.user_id WHERE viewer.club_id=c.id AND viewer.user_id=$4 AND NOT v.blocked AND viewer.state='active' AND viewer.role IN ('owner','admin'))) OR (NOT $2 AND (c.members_visibility='public' OR EXISTS(SELECT 1 FROM club_memberships viewer JOIN users v ON v.id=viewer.user_id WHERE viewer.club_id=c.id AND viewer.user_id=$4 AND NOT v.blocked AND viewer.state='active'))))) ORDER BY CASE m.state WHEN 'pending' THEN 0 WHEN 'invited' THEN 1 WHEN 'active' THEN 2 ELSE 3 END,m.created_at,m.user_id LIMIT 21 OFFSET $3`,
      [id, management, (page - 1) * 20, viewer],
    )
  ).rows;
  return {
    members: rows.slice(0, 20).map((m) => ({
      user: publicAuthor(m),
      role: m.role,
      ...(management
        ? {
            state: m.state,
            inviteExpiresAt: m.invite_expires_at?.toISOString() || null,
          }
        : {}),
    })),
    hasMore: rows.length > 20,
    page,
  };
}
export async function transferClub(
  q: Queryable,
  id: string,
  actor: string,
  raw: z.infer<typeof transferInput>,
) {
  const input = transferInput.parse(raw);
  // Read only identities before locking. Recheck them after all user locks.
  const before = (
    await q.query<{ owner_id: string; transfer_user_id: string | null }>(
      "SELECT owner_id,transfer_user_id FROM clubs WHERE id=$1",
      [id],
    )
  ).rows[0];
  if (!before) throw new CommunityError("Клуб недоступен", 404);
  const people = await lockPeople(
    q,
    actor,
    [
      before.owner_id,
      ...(before.transfer_user_id ? [before.transfer_user_id] : []),
      ...(input.targetId ? [input.targetId] : []),
    ],
    input.action === "accept" || input.action === "offer",
  );
  const c = await lockClub(q, id);
  if (
    c.owner_id !== before.owner_id ||
    c.transfer_user_id !== before.transfer_user_id ||
    c.version !== input.version
  )
    throw new CommunityError("Клуб уже изменён. Обновите страницу.", 409);
  if (input.action === "offer" || input.action === "cancel") {
    if (actor !== c.owner_id)
      throw new CommunityError("Владение передаёт владелец клуба", 403);
    if (input.action === "offer") {
      if (!input.targetId || input.targetId === actor)
        throw new CommunityError("Выберите другого участника", 400);
      const target = people.find((p) => p.id === input.targetId),
        m = await member(q, id, input.targetId);
      if (!target || target.blocked || m?.state !== "active")
        throw new CommunityError("Получатель должен состоять в клубе", 409);
    }
    await q.query(
      "UPDATE clubs SET transfer_user_id=$2,transfer_expires_at=CASE WHEN $2::uuid IS NULL THEN NULL ELSE now()+interval '7 days' END,transfer_revision=transfer_revision+1,version=version+1,updated_at=now() WHERE id=$1",
      [id, input.action === "offer" ? input.targetId : null],
    );
  } else {
    if (
      c.transfer_user_id !== actor ||
      !c.transfer_expires_at ||
      c.transfer_expires_at <= new Date()
    )
      throw new CommunityError("Предложение истекло или отозвано", 409);
    if (input.action === "accept") {
      const m = await member(q, id, actor);
      if (m?.state !== "active")
        throw new CommunityError("Получатель должен состоять в клубе", 409);
      const e = await clubEligibility(q, actor);
      if (!e.hasBike)
        throw new CommunityError(
          "Добавьте собственный велосипед для принятия владения",
          403,
        );
      if (e.owned >= 3)
        throw new CommunityError("Во владении уже три действующих клуба", 409);
      await state(q, id, c.owner_id, "active", "admin");
      await state(q, id, actor, "active", "owner");
      await q.query("UPDATE clubs SET owner_id=$2 WHERE id=$1", [id, actor]);
    }
    await q.query(
      "UPDATE clubs SET transfer_user_id=NULL,transfer_expires_at=NULL,transfer_revision=transfer_revision+1,version=version+1,updated_at=now() WHERE id=$1",
      [id],
    );
  }
  await clubAudit(
    q,
    id,
    actor,
    "ownership_" + input.action,
    input.targetId || actor,
  );
  return clubDetail(q, id, actor);
}
export async function clubAdministrativeState(
  q: Queryable,
  id: string,
  user: string,
) {
  const c = await clubDetail(q, id, user);
  if (!c.canManage)
    throw new CommunityError("Управление доступно администрации клуба", 403);
  const authorized = (
    await q.query<{
      transfer_user_id: string | null;
      transfer_expires_at: Date | null;
      audit: {
        action: string;
        createdAt: string;
        actor: {
          id: string;
          username: string;
          name: string;
          avatar_id: string | null;
        } | null;
        target: {
          id: string;
          username: string;
          name: string;
          avatar_id: string | null;
        } | null;
      }[];
    }>(
      `SELECT CASE WHEN viewer.role='owner' THEN c.transfer_user_id ELSE NULL END transfer_user_id,CASE WHEN viewer.role='owner' THEN c.transfer_expires_at ELSE NULL END transfer_expires_at,
 (SELECT coalesce(jsonb_agg(row_data ORDER BY audit_id DESC),'[]'::jsonb) FROM (
 SELECT a.id audit_id,jsonb_build_object('action',a.action,'createdAt',a.created_at,
 'actor',CASE WHEN actor.id IS NULL THEN NULL ELSE jsonb_build_object('id',actor.id,'username',actor.username,'name',actor.name,'avatar_id',actor.avatar_id) END,
 'target',CASE WHEN target.id IS NULL THEN NULL ELSE jsonb_build_object('id',target.id,'username',target.username,'name',target.name,'avatar_id',target.avatar_id) END) row_data
 FROM club_audit a LEFT JOIN users actor ON actor.id=a.actor_id AND NOT actor.blocked LEFT JOIN users target ON target.id=a.target_user_id AND NOT target.blocked WHERE a.club_id=c.id ORDER BY a.id DESC LIMIT 50) audit) audit
 FROM clubs c JOIN users co ON co.id=c.owner_id JOIN club_memberships viewer ON viewer.club_id=c.id AND viewer.user_id=$2 JOIN users v ON v.id=viewer.user_id
 WHERE c.id=$1 AND c.hidden_at IS NULL AND c.archived_at IS NULL AND NOT co.blocked AND NOT v.blocked AND viewer.state='active' AND viewer.role IN ('owner','admin')`,
      [id, user],
    )
  ).rows[0];
  if (!authorized)
    throw new CommunityError("Управление доступно администрации клуба", 403);
  return {
    transfer: authorized.transfer_user_id
      ? {
          targetId: authorized.transfer_user_id,
          expiresAt: authorized.transfer_expires_at?.toISOString() || null,
        }
      : null,
    audit: authorized.audit.map((a) => ({
      action: a.action,
      createdAt: a.createdAt,
      actor: publicAuthor(a.actor),
      target: publicAuthor(a.target),
    })),
  };
}
