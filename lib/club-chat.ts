import { z } from "zod";
import type { Queryable } from "./db.ts";
import type { ClubRole } from "./club-contracts.ts";
import {
  CHAT_TYPE,
  CHAT_ROLE,
  CHAT_MEMBER_ROLE,
  chatConfig,
  streamUserId,
} from "./chat-config.ts";
import { chatProvider, ensureChatPolicy, ChatError } from "./chat-provider.ts";
import { chatProfile, syncChatJob } from "./chat-lifecycle.ts";
import type { ChatJobRow } from "./database-rows.ts";
import { lockManagedClub, clubAudit } from "./clubs.ts";
import { EmailPolicyError } from "./email-policy.ts";
declare module "stream-chat" {
  interface CustomChannelData {
    club_id?: string;
    club_revision?: string;
    name?: string;
    image?: string;
  }
  interface CustomMemberData {
    club_role?: ClubRole;
  }
}
// This identity is never a member, never has a client JWT, and has no global
// grants. A departing human is never the provider creator of a club channel.
export const CLUB_CHAT_CREATOR = "colabike_club_service";
import { clubChannelId, clubChannelCid } from "./club-chat-id.ts";
export { clubChannelId, clubChannelCid, clubIdOfCid } from "./club-chat-id.ts";
interface ClubChatRow {
  id: string;
  name: string;
  logo_id: string | null;
  hidden_at: Date | null;
  archived_at: Date | null;
  owner_blocked: boolean | null;
  chat_revision: string;
  chat_synced_revision: string;
  external_chat_url: string | null;
  role: ClubRole;
  verified: Date | null;
}
async function memberClub(q: Queryable, id: string, actor: string) {
  const c = (
    await q.query<ClubChatRow>(
      `SELECT c.*,co.blocked owner_blocked,m.role,u.email_verified_at verified FROM clubs c JOIN club_memberships m ON m.club_id=c.id AND m.user_id=$2 JOIN users u ON u.id=m.user_id LEFT JOIN users co ON co.id=c.owner_id WHERE c.id=$1 AND c.hidden_at IS NULL AND (c.owner_id IS NULL OR NOT co.blocked) AND m.state='active' AND NOT u.blocked`,
      [id, actor],
    )
  ).rows[0];
  if (!c) throw new ChatError("Чат клуба недоступен", 404);
  return c;
}
export async function clubChatState(q: Queryable, id: string, actor: string) {
  const c = await memberClub(q, id, actor),
    job = (
      await q.query<{ attempts: number }>(
        "SELECT attempts FROM club_chat_jobs WHERE club_id=$1",
        [id],
      )
    ).rows[0];
  return {
    viewerId: actor,
    clubId: id,
    cid: clubChannelCid(id),
    enabled: !!chatConfig(),
    archived: !!c.archived_at,
    verified: !!c.verified,
    status: !chatConfig()
      ? "off"
      : String(c.chat_synced_revision) === String(c.chat_revision)
        ? "ready"
        : job?.attempts
          ? "retry"
          : "syncing",
    externalUrl: c.external_chat_url,
    canModerate: ["owner", "admin"].includes(c.role),
  };
}
const MAX_RECONCILE_MEMBERS = 10000,
  PAGE = 100;
/** The caller holds club, not user locks taken later. Membership mutations use
 * users → club; provider projection never inserts other people's SQL identities.
 * Only the latest SQL revision is applied, including after an RPC/commit failure. */
export async function syncClubChannel(
  q: Queryable,
  id: string,
  provider = chatProvider(),
) {
  const c = (
    await q.query<ClubChatRow>(
      "SELECT c.*,co.blocked owner_blocked FROM clubs c LEFT JOIN users co ON co.id=c.owner_id WHERE c.id=$1 FOR UPDATE OF c",
      [id],
    )
  ).rows[0];
  if (!c) return;
  await ensureChatPolicy(provider);
  const enabled = !!chatConfig();
  if (!enabled) {
    const existing = await provider.queryChannels(
      { cid: clubChannelCid(id) },
      [],
      { limit: 1, watch: false, state: false },
    );
    if (!existing.length) {
      await q.query(
        "UPDATE club_chat_jobs SET next_attempt_at=now()+interval '30 seconds' WHERE club_id=$1",
        [id],
      );
      return;
    }
  }
  const desired = (
    await q.query<{
      id: string;
      name: string;
      avatar_id: string | null;
      role: ClubRole;
    }>(
      `SELECT u.id,u.name,u.avatar_id,m.role FROM club_memberships m JOIN users u ON u.id=m.user_id WHERE m.club_id=$1 AND m.state='active' AND NOT u.blocked AND u.email_verified_at IS NOT NULL AND $2 ORDER BY u.id LIMIT $3`,
      [
        id,
        enabled && !c.hidden_at && !c.owner_blocked,
        MAX_RECONCILE_MEMBERS + 1,
      ],
    )
  ).rows;
  if (desired.length > MAX_RECONCILE_MEMBERS)
    throw new ChatError(
      "Для такого состава требуется проверить лимиты провайдера",
      503,
    );
  if (enabled)
    await provider.upsertUser({
      id: CLUB_CHAT_CREATOR,
      role: CHAT_ROLE,
      name: "ColaBike clubs",
      image: "",
    });
  const channel = provider.channel(CHAT_TYPE, clubChannelId(id), {
    created_by_id: CLUB_CHAT_CREATOR,
    members: [],
    club_id: id,
  });
  if (enabled) await channel.create();
  const remote = new Map<
    string,
    { banned?: boolean; channel_role?: string; club_role?: ClubRole }
  >();
  let after: string | undefined;
  for (let scanned = 0; scanned <= MAX_RECONCILE_MEMBERS; scanned += PAGE) {
    const result = await channel.queryMembers(
      {},
      { user_id: 1 },
      { limit: PAGE, ...(after ? { user_id_gt: after } : {}) },
    );
    for (const m of result.members) {
      const uid = m.user_id || m.user?.id;
      if (uid) remote.set(uid, m);
    }
    if (result.members.length < PAGE) break;
    const last = result.members.at(-1);
    const next = last?.user_id || last?.user?.id;
    if (!next || next === after)
      throw new ChatError("Провайдер не подтвердил пагинацию состава", 503);
    after = next;
    if (scanned === MAX_RECONCILE_MEMBERS)
      throw new ChatError("Не удалось ограничить состав провайдера", 503);
  }
  const wanted = new Map(desired.map((u) => [streamUserId(u.id), u]));
  const removed = [...remote.keys()].filter((uid) => !wanted.has(uid));
  for (let offset = 0; offset < removed.length; offset += PAGE)
    await channel.removeMembers(removed.slice(offset, offset + PAGE));
  for (let offset = 0; offset < desired.length; offset += PAGE) {
    const people = desired.slice(offset, offset + PAGE);
    await provider.upsertUsers(people.map((u) => chatProfile(u)));
    const additions = people.filter((u) => !remote.has(streamUserId(u.id)));
    if (additions.length)
      await channel.addMembers(
        additions.map((u) => ({
          user_id: streamUserId(u.id),
          channel_role: CHAT_MEMBER_ROLE,
          club_role: u.role,
        })),
      );
    for (const u of people) {
      const member = remote.get(streamUserId(u.id));
      if (member?.banned)
        throw new ChatError(
          "Провайдер ограничил участника. Синхронизация требует проверки",
          503,
        );
      if (
        member &&
        (member.club_role !== u.role ||
          member.channel_role !== CHAT_MEMBER_ROLE)
      )
        await channel.updateMemberPartial(
          { set: { channel_role: CHAT_MEMBER_ROLE, club_role: u.role } },
          { userId: streamUserId(u.id) },
        );
    }
  }
  // Frozen channels retain the saved cohort's history but reject new messages
  // through Stream's own grants. Hidden clubs/blocked owners have no members.
  await channel.updatePartial({
    set: {
      club_id: id,
      club_revision: String(c.chat_revision),
      name: c.name,
      image:
        c.logo_id && process.env.APP_ORIGIN
          ? new URL(
              "/api/clubs/" + id + "/media/" + c.logo_id,
              process.env.APP_ORIGIN,
            ).href
          : "",
      frozen: !enabled || !!c.archived_at || !!c.hidden_at || !!c.owner_blocked,
    },
  });
  if (!enabled) {
    await q.query(
      "UPDATE club_chat_jobs SET next_attempt_at=now()+interval '30 seconds' WHERE club_id=$1",
      [id],
    );
    return;
  }
  await q.query(
    "UPDATE clubs SET chat_synced_revision=$2,chat_synced_at=now() WHERE id=$1",
    [id, c.chat_revision],
  );
  await q.query("DELETE FROM club_chat_jobs WHERE club_id=$1 AND revision=$2", [
    id,
    c.chat_revision,
  ]);
}
export async function openClubChat(
  q: Queryable,
  id: string,
  actor: string,
  provider = chatProvider(),
) {
  const c = await memberClub(q, id, actor);
  if (!c.verified) throw new EmailPolicyError();
  await syncClubChannel(q, id, provider);
  await memberClub(q, id, actor);
  return { cid: clubChannelCid(id) };
}
const externalUrl = z
  .url()
  .max(2048)
  .refine((raw) => {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password;
  }, "Укажите HTTPS-ссылку без логина и пароля");
export const clubChatSettingsInput = z
  .object({
    externalUrl: z.union([externalUrl, z.literal("")]),
    version: z.number().int().positive(),
  })
  .strict();
export async function setClubChatSettings(
  q: Queryable,
  id: string,
  actor: string,
  raw: z.infer<typeof clubChatSettingsInput>,
) {
  const input = clubChatSettingsInput.parse(raw);
  await lockManagedClub(q, id, actor, input.version);
  await q.query(
    "UPDATE clubs SET external_chat_url=$2,version=version+1,updated_at=now() WHERE id=$1",
    [id, input.externalUrl || null],
  );
  await clubAudit(q, id, actor, "chat_link_changed");
  return { ok: true, version: input.version + 1 };
}
/** Server moderation of this channel only; never a global Stream admin role. */
export async function deleteClubChatMessage(
  q: Queryable,
  id: string,
  actor: string,
  message: string,
  provider = chatProvider(),
) {
  z.string()
    .regex(/^[A-Za-z0-9_.:-]{1,200}$/)
    .parse(message);
  await lockManagedClub(q, id, actor);
  const c = await memberClub(q, id, actor);
  if (!["owner", "admin"].includes(c.role))
    throw new ChatError("Модерация недоступна", 403);
  await ensureChatPolicy(provider);
  try {
    const found = await provider.getMessage(message);
    if (found.message.cid !== clubChannelCid(id))
      throw new ChatError("Сообщение недоступно", 404);
    await provider.deleteMessage(message, true);
  } catch (error) {
    if (error instanceof ChatError) throw error;
    throw new ChatError(
      "Не удалось выполнить модерацию чата. Попробуйте позже.",
      503,
    );
  }
  await clubAudit(q, id, actor, "chat_message_removed");
  return { ok: true };
}

/** Close existing sockets/old JWTs without taking users after a club lock. The
 * plain-ID queue can be written by club triggers, including hidden/archive,
 * while the consumer uses the existing users → chat_jobs order. */
export async function syncClubRevocation(
  q: Queryable,
  club: string,
  user: string,
  revision: string,
  provider = chatProvider(),
) {
  const present = (
    await q.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user])
  ).rowCount;
  const job = (
    await q.query<{ revision: string }>(
      "SELECT revision FROM club_chat_revocations WHERE club_id=$1 AND user_id=$2 AND revision=$3 FOR UPDATE",
      [club, user, revision],
    )
  ).rows[0];
  if (!job) return;
  if (present) {
    await q.query("SELECT cola_queue_chat($1,'sync',true)", [user]);
    const global = (
      await q.query<ChatJobRow>(
        "SELECT * FROM chat_jobs WHERE user_id=$1 FOR UPDATE",
        [user],
      )
    ).rows[0];
    if (global && !(await syncChatJob(q, global, provider)))
      throw new ChatError("Отзыв доступа ещё выполняется", 503);
  }
  await q.query(
    "DELETE FROM club_chat_revocations WHERE club_id=$1 AND user_id=$2 AND revision=$3",
    [club, user, revision],
  );
}
export async function syncViewerClubChannels(
  q: Queryable,
  actor: string,
  provider = chatProvider(),
) {
  const jobs = (
    await q.query<{ club_id: string }>(
      "SELECT j.club_id FROM club_chat_jobs j JOIN club_memberships m ON m.club_id=j.club_id WHERE m.user_id=$1 ORDER BY j.club_id LIMIT 21",
      [actor],
    )
  ).rows;
  if (jobs.length > 20)
    throw new ChatError("Обновляем доступ к сообщениям. Попробуйте позже", 503);
  for (const job of jobs) await syncClubChannel(q, job.club_id, provider);
}

/** A token issued after an archive must not be disconnected by its older queued
 * revocation. The caller already holds this user's lock before any club lock. */
export async function syncViewerClubRevocations(
  q: Queryable,
  actor: string,
  provider = chatProvider(),
) {
  const jobs = (
    await q.query<{ club_id: string; revision: string }>(
      "SELECT club_id,revision::text FROM club_chat_revocations WHERE user_id=$1 ORDER BY club_id LIMIT 21",
      [actor],
    )
  ).rows;
  if (jobs.length > 20)
    throw new ChatError("Обновляем доступ к сообщениям. Попробуйте позже", 503);
  for (const job of jobs)
    await syncClubRevocation(q, job.club_id, actor, job.revision, provider);
}
