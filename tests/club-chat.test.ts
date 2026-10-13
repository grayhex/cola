import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./support/database.ts";
import { userRow, viewer, sessionRow } from "./support/people.ts";
import { bikeRow } from "./support/bikes.ts";
import { clubRow } from "./support/clubs.ts";
import { fixtureProvider } from "./fixtures/chat-provider.js";
import {
  createChatChannel,
  issueChatToken,
  channelInput,
  leaveChatChannel,
} from "../lib/chat.ts";
import {
  clubChannelCid,
  clubChannelId,
  syncClubChannel,
  syncClubRevocation,
  deleteClubChatMessage,
  clubChatState,
  setClubChatSettings,
  CLUB_CHAT_CREATOR,
} from "../lib/club-chat.ts";
import {
  changeMembership,
  manageClubMember,
  transferClub,
} from "../lib/club-membership.ts";
import { clubDetail, setClubArchived } from "../lib/clubs.ts";
import { syncChatJob } from "../lib/chat-lifecycle.ts";
import { streamUserId, CHAT_ROLE } from "../lib/chat-config.ts";
import type { ChatJobRow } from "../lib/database-rows.ts";
const db = await testDatabase();
after(() => db.close());
const oldEnv = {
  enabled: process.env.STREAM_CHAT_ENABLED,
  key: process.env.STREAM_CHAT_API_KEY,
  secret: process.env.STREAM_CHAT_API_SECRET,
};
process.env.STREAM_CHAT_ENABLED = "true";
process.env.STREAM_CHAT_API_KEY = "test-key";
process.env.STREAM_CHAT_API_SECRET = "test-secret";
after(() => {
  for (const [key, value] of Object.entries({
    STREAM_CHAT_ENABLED: oldEnv.enabled,
    STREAM_CHAT_API_KEY: oldEnv.key,
    STREAM_CHAT_API_SECRET: oldEnv.secret,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
async function setup() {
  const owner = await userRow(db, { email_verified_at: new Date() }),
    member = await userRow(db, { email_verified_at: new Date() }),
    outsider = await userRow(db, {
      email_verified_at: new Date(),
      role: "admin",
    });
  await bikeRow(db, owner.id, { is_public: false });
  await bikeRow(db, member.id, { is_public: false });
  for (const u of [owner, member, outsider])
    await sessionRow(db, u.id, { token_hash: u.id });
  const club = await db.transaction((q) => clubRow(q, owner.id)),
    provider = fixtureProvider();
  await db.transaction((q) =>
    changeMembership(q, club.id, member.id, { action: "join" }),
  );
  return { owner, member, outsider, club, provider };
}
async function token(p: Awaited<ReturnType<typeof setup>>, who = p.member) {
  return (
    await db.transaction((q) =>
      issueChatToken(q, viewer(who), who.id, p.provider),
    )
  ).token;
}
async function global(p: Awaited<ReturnType<typeof setup>>, user: string) {
  await db.transaction(async (q) => {
    const job = (
      await q.query<ChatJobRow>("SELECT * FROM chat_jobs WHERE user_id=$1", [
        user,
      ])
    ).rows[0];
    if (job) await syncChatJob(q, job, p.provider);
  });
}
test("one server-created club channel uses current SQL members and roles, >8 and paginated batches; ordinary group limit remains", async () => {
  const p = await setup();
  for (let i = 0; i < 108; i++) {
    const u = await userRow(db, { email_verified_at: new Date() });
    await db.transaction((q) =>
      changeMembership(q, p.club.id, u.id, { action: "join" }),
    );
  }
  const opened = await db.transaction((q) =>
    createChatChannel(
      q,
      viewer(p.owner),
      { kind: "club", clubId: p.club.id },
      p.owner.id,
      p.provider,
    ),
  );
  assert.equal(opened.cid, clubChannelCid(p.club.id));
  assert.equal(p.provider.channels.size, 1);
  const remote = p.provider.channels.get(opened.cid);
  assert.ok(remote);
  assert.equal(remote.members.length, 110);
  assert.equal(remote.created_by_id, CLUB_CHAT_CREATOR);
  assert.equal(p.provider.users.get(streamUserId(p.owner.id))?.role, CHAT_ROLE);
  assert.equal(
    remote.members.find((m) => m.user_id === streamUserId(p.owner.id))
      ?.club_role,
    "owner",
  );
  await db.transaction((q) => syncClubChannel(q, p.club.id, p.provider));
  assert.equal(remote.members.length, 110);
  assert.equal(
    channelInput.safeParse({
      kind: "group",
      name: "Too many",
      members: Array.from({ length: 8 }, () => randomUUID()),
    }).success,
    false,
  );
  await assert.rejects(
    db.transaction((q) =>
      leaveChatChannel(
        q,
        viewer(p.member),
        { cid: opened.cid },
        p.member.id,
        p.provider,
      ),
    ),
    /Invalid|match|invalid/i,
  );
  await assert.rejects(
    db.transaction((q) =>
      createChatChannel(
        q,
        viewer(p.outsider),
        { kind: "club", clubId: p.club.id },
        p.outsider.id,
        p.provider,
      ),
    ),
    /недоступен/,
  );
});
test("departure queues token/socket revocation; old watch/query/history and another open device fail, even with an old CID", async () => {
  const p = await setup(),
    jwt = await token(p),
    client = p.provider.asClient(jwt),
    socket = client.channel("colabike", clubChannelId(p.club.id));
  await socket.watch();
  await socket.sendMessage({ text: "Закрытая переписка" });
  await db.transaction((q) =>
    changeMembership(q, p.club.id, p.member.id, { action: "leave" }),
  );
  await global(p, p.member.id);
  await db.transaction((q) => syncClubChannel(q, p.club.id, p.provider));
  await assert.rejects(
    socket.sendMessage({ text: "Старое устройство" }),
    /denied/,
  );
  await assert.rejects(socket.query(), /denied/);
  await assert.rejects(
    client.queryChannels({ cid: clubChannelCid(p.club.id) }),
    /denied/,
  );
  assert.ok(
    p.provider.calls.some(
      (c) => c[0] === "revoke" && c[1] === streamUserId(p.member.id),
    ),
  );
  assert.ok(
    p.provider.calls.some(
      (c) => c[0] === "deactivate" && c[1] === streamUserId(p.member.id),
    ),
  );
  // A token issued afterwards for personal conversations still does not grant
  // this club's history. The fixture simulates provider checks, not live Stream.
  const fresh = await token(p);
  await assert.rejects(
    p.provider
      .asClient(fresh)
      .channel("colabike", clubChannelId(p.club.id))
      .watch(),
    /denied/,
  );
});
test("late add jobs apply the latest state; exclusion/blocking never re-adds a person, and former human owner is not provider creator", async () => {
  const p = await setup();
  await token(p, p.owner);
  const offer = await db.transaction((q) =>
    transferClub(q, p.club.id, p.owner.id, {
      action: "offer",
      targetId: p.member.id,
      version: p.club.version,
    }),
  );
  await db.transaction((q) =>
    transferClub(q, p.club.id, p.member.id, {
      action: "accept",
      version: offer.version,
    }),
  );
  await db.transaction((q) =>
    changeMembership(q, p.club.id, p.owner.id, { action: "leave" }),
  );
  await db.transaction((q) => syncClubChannel(q, p.club.id, p.provider));
  const data = p.provider.channels.get(clubChannelCid(p.club.id));
  assert.ok(data);
  assert.equal(data.created_by_id, CLUB_CHAT_CREATOR);
  assert.equal(
    data.members.some((m) => m.user_id === streamUserId(p.owner.id)),
    false,
  );
  await db.transaction((q) =>
    changeMembership(q, p.club.id, p.owner.id, { action: "join" }),
  );
  await db.transaction((q) =>
    manageClubMember(q, p.club.id, p.member.id, p.owner.id, {
      action: "block",
    }),
  );
  await db.transaction((q) => syncClubChannel(q, p.club.id, p.provider));
  assert.equal(
    data.members.some((m) => m.user_id === streamUserId(p.owner.id)),
    false,
  );
  await assert.rejects(clubChatState(db, p.club.id, p.owner.id), /недоступен/);
});
test("archive freezes provider sending and queues disconnects; saved members read history, outsiders and departed members do not", async () => {
  const p = await setup(),
    jwt = await token(p),
    old = p.provider
      .asClient(jwt)
      .channel("colabike", clubChannelId(p.club.id));
  await old.watch();
  await db.transaction((q) =>
    setClubArchived(q, p.club.id, p.owner.id, {
      archived: true,
      version: p.club.version,
    }),
  );
  const queue = (
    await db.query<{ revision: string }>(
      "SELECT revision::text FROM club_chat_revocations WHERE club_id=$1 AND user_id=$2",
      [p.club.id, p.member.id],
    )
  ).rows[0];
  assert.ok(queue);
  await db.transaction((q) =>
    syncClubRevocation(q, p.club.id, p.member.id, queue.revision, p.provider),
  );
  await db.transaction((q) => syncClubChannel(q, p.club.id, p.provider));
  await assert.rejects(old.query(), /denied/);
  const fresh = p.provider
    .asClient(await token(p))
    .channel("colabike", clubChannelId(p.club.id));
  await fresh.query();
  await assert.rejects(fresh.sendMessage({ text: "Архив" }), /frozen/);
  await db.transaction((q) =>
    changeMembership(q, p.club.id, p.member.id, { action: "leave" }),
  );
  await db.transaction((q) => syncClubChannel(q, p.club.id, p.provider));
  await assert.rejects(fresh.query(), /denied/);
});
test("administrators delete only their club messages; site role, foreign message IDs and revoked roles never broaden moderation", async () => {
  const p = await setup(),
    jwt = await token(p),
    message = (
      await p.provider
        .asClient(jwt)
        .channel("colabike", clubChannelId(p.club.id))
        .sendMessage({ text: "Сообщение для модерации" })
    ).message;
  assert.ok(message.id);
  await assert.rejects(
    db.transaction((q) =>
      deleteClubChatMessage(
        q,
        p.club.id,
        p.outsider.id,
        message.id!,
        p.provider,
      ),
    ),
    /недоступен|администрации/,
  );
  p.provider.messages.set("foreign", {
    id: "foreign",
    cid: "colabike:group_foreign",
  });
  await assert.rejects(
    db.transaction((q) =>
      deleteClubChatMessage(q, p.club.id, p.owner.id, "foreign", p.provider),
    ),
    /недоступно/,
  );
  await db.transaction((q) =>
    deleteClubChatMessage(q, p.club.id, p.owner.id, message.id!, p.provider),
  );
  assert.equal(p.provider.messages.has(message.id), false);
  await assert.rejects(
    db.transaction((q) =>
      deleteClubChatMessage(q, p.club.id, p.member.id, "foreign", p.provider),
    ),
    /администрации/,
  );
});
test("external URL is private to members, does not replace unavailable Stream, and failed projection remains queued", async () => {
  const p = await setup();
  await db.transaction((q) =>
    setClubChatSettings(q, p.club.id, p.owner.id, {
      externalUrl: "https://t.me/club-private-example",
      version: p.club.version,
    }),
  );
  assert.equal(
    JSON.stringify(await clubDetail(db, p.club.id)).includes(
      "club-private-example",
    ),
    false,
  );
  await assert.rejects(
    clubChatState(db, p.club.id, p.outsider.id),
    /недоступен/,
  );
  assert.equal(
    (await clubChatState(db, p.club.id, p.member.id)).externalUrl,
    "https://t.me/club-private-example",
  );
  const c = await clubDetail(db, p.club.id, p.owner.id);
  await assert.rejects(
    db.transaction((q) =>
      setClubChatSettings(q, p.club.id, p.owner.id, {
        externalUrl: "https://secret@example.test/",
        version: c.version,
      }),
    ),
    /HTTPS/,
  );
  await db.query("UPDATE users SET name=$2 WHERE id=$1", [
    p.member.id,
    "vendor-failure-private",
  ]);
  await assert.rejects(
    db.transaction((q) => syncClubChannel(q, p.club.id, p.provider)),
  );
  assert.equal(
    (
      await db.query("SELECT 1 FROM club_chat_jobs WHERE club_id=$1", [
        p.club.id,
      ])
    ).rowCount,
    1,
  );
  process.env.STREAM_CHAT_ENABLED = "false";
  try {
    const state = await clubChatState(db, p.club.id, p.member.id);
    assert.equal(state.enabled, false);
    assert.equal(state.status, "off");
    assert.equal(state.externalUrl, "https://t.me/club-private-example");
  } finally {
    process.env.STREAM_CHAT_ENABLED = "true";
  }
});

test("a bulk-created member profile follows edits and deletion even before its first chat JWT", async () => {
  const p = await setup();
  await db.transaction((q) => syncClubChannel(q, p.club.id, p.provider));
  assert.equal(
    (
      await db.query("SELECT 1 FROM chat_identities WHERE user_id=$1", [
        p.member.id,
      ])
    ).rowCount,
    0,
  );
  await db.query("UPDATE users SET name='Новое имя' WHERE id=$1", [
    p.member.id,
  ]);
  assert.equal(
    (
      await db.query("SELECT 1 FROM club_chat_jobs WHERE club_id=$1", [
        p.club.id,
      ])
    ).rowCount,
    1,
  );
  await db.transaction((q) => syncClubChannel(q, p.club.id, p.provider));
  assert.equal(
    p.provider.users.get(streamUserId(p.member.id))?.name,
    "Новое имя",
  );
  await db.query("DELETE FROM users WHERE id=$1", [p.member.id]);
  await global(p, p.member.id);
  assert.equal(p.provider.users.has(streamUserId(p.member.id)), false);
  await db.transaction((q) => syncClubChannel(q, p.club.id, p.provider));
  assert.equal(
    p.provider.channels
      .get(clubChannelCid(p.club.id))
      ?.members.some((m) => m.user_id === streamUserId(p.member.id)),
    false,
  );
});
