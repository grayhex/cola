import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Queryable } from "./db.ts";
import type {
  ClubDto,
  ClubSummaryDto,
  ClubEligibility,
  ClubRole,
  ClubState,
} from "./club-contracts.ts";
import { uuid } from "./validation.ts";
import { CommunityError } from "./community-validation.ts";
import { EmailPolicyError } from "./email-policy.ts";
import { parseRichText } from "./rich-text.ts";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !s.includes("\0"));
export const clubDetailsInput = z
  .object({
    name: text(80).min(1),
    slogan: text(180).default(""),
    city: text(80).default(""),
    formats: z
      .array(text(40).min(1))
      .max(8)
      .refine((a) => new Set(a).size === a.length)
      .default([]),
    mission: text(20000).default(""),
    joinMode: z.enum(["application", "open"]).default("application"),
    membersVisibility: z.enum(["public", "members"]).default("members"),
  })
  .strict();
export const clubCreateInput = clubDetailsInput
  .extend({ requestId: uuid })
  .strict();
export const clubEditInput = clubDetailsInput
  .extend({ version: z.number().int().positive() })
  .strict();
export const clubRulesInput = z
  .object({ body: text(20000), version: z.number().int().positive() })
  .strict();
export const clubPath = (id: string) => "/clubs/" + id;
export const clubMediaPath = (id: string, photoId: string) =>
  "/api/clubs/" + id + "/media/" + photoId;
export interface ClubRow {
  id: string;
  owner_id: string | null;
  name: string;
  slogan: string;
  city: string;
  formats: string[];
  mission: string;
  rules: string;
  rules_updated_at: Date | string | null;
  join_mode: "application" | "open";
  members_visibility: "public" | "members";
  logo_id: string | null;
  cover_id: string | null;
  archived_at: Date | string | null;
  version: number;
  member_count: number;
  member_state: ClubState | null;
  member_role: ClubRole | null;
}
const visible = "c.hidden_at IS NULL AND (c.owner_id IS NULL OR NOT u.blocked)";
const memberColumns = `(SELECT count(*)::int FROM club_memberships cm JOIN users mu ON mu.id=cm.user_id
 WHERE cm.club_id=c.id AND cm.state='active' AND NOT mu.blocked) member_count,
 m.state member_state,m.role member_role`;
const columns = `c.*,${memberColumns}`;
const summaryColumns = `c.id,c.name,c.slogan,c.city,c.formats,c.join_mode,c.members_visibility,c.logo_id,c.cover_id,c.archived_at,${memberColumns}`;
const from = `FROM clubs c LEFT JOIN users u ON u.id=c.owner_id
 LEFT JOIN club_memberships m ON m.club_id=c.id AND m.user_id=$2
 AND EXISTS(SELECT 1 FROM users viewer WHERE viewer.id=$2 AND NOT viewer.blocked)`;
const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);
type ClubSummaryRow = Omit<
  ClubRow,
  "owner_id" | "mission" | "rules" | "rules_updated_at" | "version"
>;
function clubSummaryDto(c: ClubSummaryRow): ClubSummaryDto {
  return {
    id: c.id,
    name: c.name,
    slogan: c.slogan,
    city: c.city,
    formats: c.formats,
    joinMode: c.join_mode,
    membersVisibility: c.members_visibility,
    logo: c.logo_id ? clubMediaPath(c.id, c.logo_id) : null,
    cover: c.cover_id ? clubMediaPath(c.id, c.cover_id) : null,
    archived: !!c.archived_at,
    memberCount: c.member_count,
    membership:
      c.member_state && c.member_role
        ? { state: c.member_state, role: c.member_role }
        : null,
    canManage:
      !c.archived_at &&
      c.member_state === "active" &&
      ["owner", "admin"].includes(c.member_role || ""),
  };
}
export function clubDto(c: ClubRow): ClubDto {
  return {
    ...clubSummaryDto(c),
    mission: c.mission,
    missionDoc: parseRichText(c.mission),
    rules: c.rules,
    rulesDoc: parseRichText(c.rules),
    rulesUpdatedAt: iso(c.rules_updated_at),
    version: c.version,
  };
}
export async function clubDetail(
  q: Queryable,
  id: string,
  viewer: string | null = null,
) {
  const c = (
    await q.query<ClubRow>(
      `SELECT ${columns} ${from} WHERE c.id=$1 AND ${visible}`,
      [id, viewer],
    )
  ).rows[0];
  if (!c) throw new CommunityError("Клуб недоступен", 404);
  return clubDto(c);
}
export async function clubList(
  q: Queryable,
  viewer: string | null,
  options: {
    page?: number;
    search?: string;
    city?: string;
    format?: string;
    own?: boolean;
  } = {},
) {
  const page = z
    .number()
    .int()
    .min(1)
    .max(10000)
    .parse(options.page || 1);
  if (options.own && !viewer)
    throw new CommunityError("Войдите в аккаунт", 401);
  const rows = (
    await q.query<ClubSummaryRow>(
      `SELECT ${summaryColumns} ${from}
 WHERE ${visible} AND c.archived_at IS NULL
 AND ($1='' OR position(lower($1) IN lower(c.name || ' ' || c.slogan))>0)
 AND ($3='' OR lower(c.city)=lower($3)) AND ($4='' OR $4=ANY(c.formats))
 AND (NOT $5 OR m.state IN ('active','pending','invited'))
 ORDER BY c.created_at DESC,c.id LIMIT 21 OFFSET $6`,
      [
        (options.search || "").slice(0, 100),
        viewer,
        (options.city || "").slice(0, 80),
        (options.format || "").slice(0, 40),
        !!options.own,
        (page - 1) * 20,
      ],
    )
  ).rows;
  return {
    clubs: rows.slice(0, 20).map(clubSummaryDto),
    hasMore: rows.length > 20,
    page,
  };
}
export async function clubEligibility(
  q: Queryable,
  user: string,
): Promise<ClubEligibility> {
  const row = (
    await q.query<{ verified: boolean; has_bike: boolean; owned: number }>(
      `SELECT email_verified_at IS NOT NULL verified,
 EXISTS(SELECT 1 FROM bikes WHERE owner_id=u.id) has_bike,
 (SELECT count(*)::int FROM clubs WHERE owner_id=u.id AND archived_at IS NULL) owned
 FROM users u WHERE id=$1 AND NOT blocked`,
      [user],
    )
  ).rows[0];
  if (!row) throw new CommunityError("Аккаунт недоступен", 403);
  return {
    verified: row.verified,
    hasBike: row.has_bike,
    owned: row.owned,
    canCreate: row.verified && row.has_bike && row.owned < 3,
  };
}
// Always take the user lock BEFORE club locks; creation/transfer/restore share it.
export async function lockClubActor(q: Queryable, user: string) {
  const row = (
    await q.query<{ email_verified_at: Date | null }>(
      "SELECT email_verified_at FROM users WHERE id=$1 AND NOT blocked FOR UPDATE",
      [user],
    )
  ).rows[0];
  if (!row) throw new CommunityError("Аккаунт недоступен", 403);
  if (!row.email_verified_at) throw new EmailPolicyError();
}
export async function lockManagedClub(
  q: Queryable,
  id: string,
  user: string,
  version?: number,
) {
  await lockClubActor(q, user);
  const club = (
    await q.query<ClubRow>(
      `SELECT ${columns} ${from} WHERE c.id=$1 AND ${visible} FOR UPDATE OF c`,
      [id, user],
    )
  ).rows[0];
  if (!club) throw new CommunityError("Клуб недоступен", 404);
  if (
    club.archived_at ||
    club.member_state !== "active" ||
    !["owner", "admin"].includes(club.member_role || "")
  )
    throw new CommunityError(
      "Управление доступно администрации действующего клуба",
      403,
    );
  if (version !== undefined && club.version !== version)
    throw new CommunityError(
      "Клуб уже изменён. Обновите страницу перед сохранением.",
      409,
    );
  return club;
}
export async function clubAudit(
  q: Queryable,
  club: string,
  actor: string,
  action: string,
) {
  await q.query(
    "INSERT INTO club_audit(club_id,actor_id,action) VALUES($1,$2,$3)",
    [club, actor, action],
  );
}
export async function createClub(
  q: Queryable,
  user: string,
  raw: z.infer<typeof clubCreateInput>,
) {
  const input = clubCreateInput.parse(raw);
  await lockClubActor(q, user);
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const previous = (
    await q.query<{ club_id: string; input_hash: string }>(
      "SELECT club_id,input_hash FROM club_create_requests WHERE user_id=$1 AND request_id=$2",
      [user, input.requestId],
    )
  ).rows[0];
  if (previous) {
    if (previous.input_hash !== hash)
      throw new CommunityError(
        "Этот запрос уже использован для другого клуба",
        409,
      );
    return clubDetail(q, previous.club_id, user);
  }
  const eligibility = await clubEligibility(q, user);
  if (!eligibility.hasBike)
    throw new CommunityError(
      "Добавьте собственный велосипед, чтобы создать клуб. Приватный велосипед тоже подходит.",
      403,
    );
  if (eligibility.owned >= 3)
    throw new CommunityError(
      "Во владении уже три действующих клуба. Сначала передайте или архивируйте один из них.",
      409,
    );
  const id = randomUUID();
  await q.query(
    `INSERT INTO clubs(id,owner_id,name,slogan,city,formats,mission,join_mode,members_visibility)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      user,
      input.name,
      input.slogan,
      input.city,
      input.formats,
      input.mission,
      input.joinMode,
      input.membersVisibility,
    ],
  );
  await q.query(
    "INSERT INTO club_memberships(club_id,user_id,role,state) VALUES($1,$2,'owner','active')",
    [id, user],
  );
  await q.query(
    "INSERT INTO club_create_requests(user_id,request_id,club_id,input_hash) VALUES($1,$2,$3,$4)",
    [user, input.requestId, id, hash],
  );
  await clubAudit(q, id, user, "created");
  return clubDetail(q, id, user);
}
export async function editClub(
  q: Queryable,
  id: string,
  user: string,
  raw: z.infer<typeof clubEditInput>,
) {
  const input = clubEditInput.parse(raw);
  await lockManagedClub(q, id, user, input.version);
  await q.query(
    `UPDATE clubs SET name=$2,slogan=$3,city=$4,formats=$5,mission=$6,join_mode=$7,members_visibility=$8,
 version=version+1,updated_at=now() WHERE id=$1`,
    [
      id,
      input.name,
      input.slogan,
      input.city,
      input.formats,
      input.mission,
      input.joinMode,
      input.membersVisibility,
    ],
  );
  await clubAudit(q, id, user, "edited");
  return clubDetail(q, id, user);
}
export async function editClubRules(
  q: Queryable,
  id: string,
  user: string,
  raw: z.infer<typeof clubRulesInput>,
) {
  const input = clubRulesInput.parse(raw);
  await lockManagedClub(q, id, user, input.version);
  await q.query(
    "UPDATE clubs SET rules=$2,rules_author_id=$3,rules_updated_at=now(),version=version+1,updated_at=now() WHERE id=$1",
    [id, input.body, user],
  );
  await clubAudit(q, id, user, "rules_edited");
  return clubDetail(q, id, user);
}
export const clubArchiveInput = z
  .object({ archived: z.boolean(), version: z.number().int().positive() })
  .strict();
export async function setClubArchived(
  q: Queryable,
  id: string,
  user: string,
  raw: z.infer<typeof clubArchiveInput>,
) {
  const input = clubArchiveInput.parse(raw);
  await lockClubActor(q, user);
  const c = (
    await q.query<ClubRow>(
      `SELECT ${columns} ${from} WHERE c.id=$1 AND ${visible} FOR UPDATE OF c`,
      [id, user],
    )
  ).rows[0];
  if (!c) throw new CommunityError("Клуб недоступен", 404);
  if (
    c.owner_id !== user ||
    c.member_role !== "owner" ||
    c.member_state !== "active"
  )
    throw new CommunityError("Архивом управляет владелец клуба", 403);
  if (c.version !== input.version)
    throw new CommunityError("Клуб уже изменён. Обновите страницу.", 409);
  if (!!c.archived_at === input.archived) return clubDto(c);
  if (!input.archived) {
    const eligibility = await clubEligibility(q, user);
    if (!eligibility.hasBike)
      throw new CommunityError(
        "Для восстановления добавьте собственный велосипед",
        403,
      );
    if (eligibility.owned >= 3)
      throw new CommunityError("Во владении уже три действующих клуба", 409);
  }
  await q.query(
    "UPDATE clubs SET archived_at=CASE WHEN $2 THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE id=$1",
    [id, input.archived],
  );
  await clubAudit(q, id, user, input.archived ? "archived" : "restored");
  return clubDetail(q, id, user);
}
