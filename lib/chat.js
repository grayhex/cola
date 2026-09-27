import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireVerifiedEmail } from "./email-policy.js";
import {
  chatConfig,
  CHAT_TYPE,
  CHAT_MEMBER_ROLE,
  CHAT_TOKEN_SECONDS,
  streamUserId,
} from "./chat-config.js";
import { chatProvider, ChatError, ensureChatPolicy } from "./chat-provider.js";
import { chatProfile, syncChatJob } from "./chat-lifecycle.js";

export const channelInput = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("dm"), members: z.array(z.uuid()).length(1) })
    .strict(),
  z
    .object({
      kind: z.literal("group"),
      name: z.string().trim().min(1).max(80),
      members: z.array(z.uuid()).min(2).max(7),
    })
    .strict(),
]);
export async function lockChatUsers(q, ids) {
  const users = (
    await q.query(
      "SELECT id,name,username,avatar_id,email_verified_at,blocked FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [ids],
    )
  ).rows;
  if (
    users.length !== ids.length ||
    users.some((u) => u.blocked || !u.email_verified_at)
  )
    throw new ChatError("Пользователь недоступен для сообщений", 404);
  return users;
}
export async function registerChatUsers(q, users, provider) {
  for (const user of users) {
    const job = (
      await q.query("SELECT * FROM chat_jobs WHERE user_id=$1 FOR UPDATE", [
        user.id,
      ])
    ).rows[0];
    if (job && !(await syncChatJob(q, job, provider)))
      throw new ChatError(
        "Обновляем доступ к сообщениям. Попробуйте позже",
        503,
      );
  }
  await provider.upsertUsers(users.map((u) => chatProfile(u)));
  for (const user of users)
    await q.query(
      "INSERT INTO chat_identities(user_id) VALUES($1) ON CONFLICT DO NOTHING",
      [user.id],
    );
}
async function requireSession(q, viewer, hash) {
  const result = await q.query(
    "SELECT id FROM sessions WHERE user_id=$1 AND token_hash=$2 AND expires_at>now() FOR SHARE",
    [viewer.id, hash],
  );
  if (!result.rows.length) throw new ChatError("Войдите в аккаунт заново", 401);
}
export async function issueChatToken(
  q,
  viewer,
  sessionHash,
  provider = chatProvider(),
) {
  requireVerifiedEmail(viewer);
  await ensureChatPolicy(provider);
  const users = await lockChatUsers(q, [viewer.id]);
  await requireSession(q, viewer, sessionHash);
  await registerChatUsers(q, users, provider);
  const identity = (
    await q.query("SELECT revoked_at FROM chat_identities WHERE user_id=$1", [
      viewer.id,
    ])
  ).rows[0];
  // Revocation and JWT iat must not collide within the same second.
  const wait = identity.revoked_at
    ? Math.ceil(new Date(identity.revoked_at).getTime() / 1000) * 1000 +
      10 -
      Date.now()
    : 0;
  if (wait > 1500)
    throw new ChatError("Повторите вход через несколько секунд", 503);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  const now = Math.floor(Date.now() / 1000),
    user = chatProfile(users[0]);
  return {
    apiKey: chatConfig()?.key,
    user,
    token: provider.createToken(user.id, now + CHAT_TOKEN_SECONDS, now),
    expiresAt: now + CHAT_TOKEN_SECONDS,
    type: CHAT_TYPE,
  };
}
export async function createChatChannel(
  q,
  viewer,
  raw,
  sessionHash,
  provider = chatProvider(),
) {
  requireVerifiedEmail(viewer);
  const input = channelInput.parse(raw);
  const ids = [viewer.id, ...input.members];
  if (new Set(ids).size !== ids.length)
    throw new ChatError(
      "Выберите разных участников; диалог с собой недоступен",
    );
  await ensureChatPolicy(provider);
  const users = await lockChatUsers(q, ids);
  await requireSession(q, viewer, sessionHash);
  await registerChatUsers(q, users, provider);
  const id =
    input.kind === "dm"
      ? "dm_" +
        createHash("sha256")
          .update([...ids].sort().join(":"))
          .digest("hex")
          .slice(0, 40)
      : "group_" + randomUUID().replaceAll("-", "");
  const channel = provider.channel(CHAT_TYPE, id, {
    created_by_id: streamUserId(viewer.id),
    members: ids.map((id) => ({
      user_id: streamUserId(id),
      channel_role: CHAT_MEMBER_ROLE,
    })),
    ...(input.kind === "group" ? { name: input.name } : {}),
  });
  await channel.create();
  return { cid: CHAT_TYPE + ":" + id };
}
