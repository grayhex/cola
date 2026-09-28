import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  chatConfig,
  chatCredentials,
  streamUserId,
  CHAT_MEMBER_ROLE,
  CHAT_ROLE,
} from "../lib/chat-config.js";
import { assertChatPolicy } from "../lib/chat-provider.js";
import { issueChatToken, createChatChannel } from "../lib/chat.js";
import { syncChatJob } from "../lib/chat-lifecycle.js";
import { fixtureProvider, policy } from "./fixtures/chat-provider.js";
import { pageCsp } from "../lib/csp.js";
import { chatPeople } from "../lib/chat-people.js";

test("chat is opt-in, never broadens CSP when disabled, and rejects permissive vendor policies", () => {
  assert.equal(chatConfig({}), null);
  assert.equal(
    chatConfig({ STREAM_CHAT_ENABLED: "true", STREAM_CHAT_API_KEY: "key" }),
    null,
  );
  const config = {
    STREAM_CHAT_ENABLED: "true",
    STREAM_CHAT_API_KEY: "key",
    STREAM_CHAT_API_SECRET: "secret",
  };
  assert.equal(
    chatCredentials({ ...config, STREAM_CHAT_ENABLED: "false" }).key,
    "key",
  );
  assert.doesNotMatch(pageCsp("nonce", {}), /stream-io/);
  assert.match(pageCsp("nonce", config), /wss:\/\/chat.stream-io-api.com/);
  assert.doesNotMatch(pageCsp("nonce", config), /connect-src[^;]*https: /);
  const valid = policy();
  assert.doesNotThrow(() => assertChatPolicy(valid.app, valid.type));
  for (const weaken of [
    (p) => {
      p.app.disable_auth_checks = true;
    },
    (p) => {
      p.app.disable_permissions_checks = true;
    },
    (p) => {
      p.app.grants[CHAT_ROLE] = ["create-channel"];
    },
    (p) => {
      p.app.grants[CHAT_MEMBER_ROLE] = ["search-user"];
    },
    (p) => {
      p.type.grants.channel_moderator = ["update-channel-members"];
    },
    (p) => {
      p.type.grants[CHAT_MEMBER_ROLE].push("add-channel-members");
    },
    (p) => {
      p.type.grants.user = ["read-channel"];
    },
    (p) => {
      p.type.url_enrichment = true;
    },
    (p) => {
      p.app.file_upload_config.size_limit *= 2;
    },
    (p) => {
      p.app.image_upload_config.allowed_mime_types.push("image/svg+xml");
    },
  ]) {
    const p = policy();
    weaken(p);
    assert.throws(
      () => assertChatPolicy(p.app, p.type),
      (e) => e.status === 503,
    );
  }
});

test("chat identity, authorization, lifecycle and deletion survive actual database triggers", async (t) => {
  const db = await PGlite.create();
  t.after(() => db.close());
  for (const migration of [
    "001_initial",
    "002_admin",
    "009_social_core",
    "022_auth_tokens",
    "025_account_sessions",
    "031_chat_lifecycle",
  ])
    await db.exec(
      await readFile(
        new URL("../db/" + migration + ".sql", import.meta.url),
        "utf8",
      ),
    );
  const provider = fixtureProvider();
  async function person(name, verified = true) {
    const id = randomUUID();
    const user = (
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,email_verified_at) VALUES($1,$2,$3,'hash',$4) RETURNING *",
        [id, id + "@test.invalid", name, verified ? new Date() : null],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [id, id],
    );
    return user;
  }
  const a = await person("Alice"),
    b = await person("Bob"),
    c = await person("Cara"),
    unverified = await person("Unverified", false);
  assert.deepEqual((await chatPeople(db, a.id, "")).people, []);
  await db.query("UPDATE users SET username=$2 WHERE id=$1", [
    b.id,
    "bob_rider",
  ]);
  await db.query(
    "INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2),($1,$3)",
    [a.id, b.id, unverified.id],
  );
  const suggested = await chatPeople(db, a.id, "");
  assert.equal(suggested.mode, "following");
  assert.deepEqual(
    suggested.people.map((p) => p.id),
    [b.id],
  );
  assert.deepEqual(Object.keys(suggested.people[0]).sort(), [
    "avatar_id",
    "id",
    "name",
    "username",
  ]);
  assert.deepEqual(
    (await chatPeople(db, a.id, "@BOB_RIDER")).people.map((p) => p.id),
    [b.id],
  );
  assert.deepEqual(
    (await chatPeople(db, a.id, "CaRa")).people.map((p) => p.id),
    [c.id],
  );
  assert.deepEqual((await chatPeople(db, a.id, "Alice")).people, []);
  assert.deepEqual((await chatPeople(db, a.id, "Unverified")).people, []);
  assert.deepEqual((await chatPeople(db, a.id, "__")).people, []);
  assert.deepEqual((await chatPeople(db, a.id, "%%")).people, []);
  assert.deepEqual((await chatPeople(db, a.id, "@")).people, []);
  const token = await db.transaction((q) =>
    issueChatToken(q, a, a.id, provider),
  );
  const [header, payload, signature] = token.token.split(".");
  assert.equal(
    signature,
    createHmac("sha256", "test-secret")
      .update(header + "." + payload)
      .digest("base64url"),
  );
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.user_id, streamUserId(a.id));
  assert.equal(claims.exp - claims.iat, 300);
  assert.deepEqual(Object.keys(token.user).sort(), [
    "id",
    "image",
    "name",
    "role",
  ]);
  await assert.rejects(
    db.transaction((q) => issueChatToken(q, a, "deleted-session", provider)),
    (e) => e.status === 401,
  );
  await assert.rejects(
    db.transaction((q) =>
      issueChatToken(q, unverified, unverified.id, provider),
    ),
    (e) => e.status === 403,
  );
  const channel = (viewer, members, extra = {}) =>
    db.transaction((q) =>
      createChatChannel(
        q,
        viewer,
        { kind: "dm", members, ...extra },
        viewer.id,
        provider,
      ),
    );
  const dm = await channel(a, [b.id]);
  assert.equal((await channel(a, [b.id.toUpperCase()])).cid, dm.cid);
  assert.equal(dm.cid, (await channel(b, [a.id])).cid);
  assert.deepEqual(
    provider.channels.get(dm.cid).members.map((m) => m.channel_role),
    [CHAT_MEMBER_ROLE, CHAT_MEMBER_ROLE],
  );
  await assert.rejects(channel(a, [a.id]), (e) => e.status === 400);
  await assert.rejects(channel(a, [randomUUID()]), (e) => e.status === 404);
  await assert.rejects(channel(a, [unverified.id]), (e) => e.status === 404);
  await assert.rejects(channel(a, [b.id], { created_by_id: b.id }));
  await assert.rejects(
    channel(a, [b.id, b.id], { kind: "group", name: "Test" }),
    (e) => e.status === 400,
  );
  const group = await channel(a, [b.id, c.id], {
    kind: "group",
    name: "Riders",
  });
  assert.equal(provider.channels.get(group.cid).members.length, 3);
  await db.query("UPDATE users SET name='Alice new',avatar_id=$2 WHERE id=$1", [
    a.id,
    randomUUID(),
  ]);
  let job = (await db.query("SELECT * FROM chat_jobs WHERE user_id=$1", [a.id]))
    .rows[0];
  assert.equal(job.kind, "sync");
  await db.transaction((q) => syncChatJob(q, job, provider));
  assert.equal(provider.users.get(streamUserId(a.id)).name, "Alice new");
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [b.id]);
  assert.deepEqual((await chatPeople(db, a.id, "")).people, []);
  assert.deepEqual((await chatPeople(db, a.id, "@bob_rider")).people, []);
  await assert.rejects(channel(a, [b.id]), (e) => e.status === 404);
  job = (await db.query("SELECT * FROM chat_jobs WHERE user_id=$1", [b.id]))
    .rows[0];
  await db.transaction((q) => syncChatJob(q, job, provider));
  assert.ok(provider.users.get(streamUserId(b.id)).deactivated_at);
  assert.ok(
    provider.calls.find(
      (c) => c[0] === "revoke" && c[1] === streamUserId(b.id),
    ),
  );
  await db.query("UPDATE users SET blocked=false WHERE id=$1", [b.id]);
  await channel(a, [b.id]);
  assert.equal(
    provider.users.get(streamUserId(b.id)).deactivated_at,
    undefined,
  );
  await db.query("DELETE FROM sessions WHERE user_id=$1", [a.id]);
  job = (await db.query("SELECT * FROM chat_jobs WHERE user_id=$1", [a.id]))
    .rows[0];
  assert.ok(job.revoke_before);
  await assert.rejects(
    db.transaction((q) => issueChatToken(q, a, a.id, provider)),
    (e) => e.status === 401,
  );
  await db.transaction((q) => syncChatJob(q, job, provider));
  // A failed vendor deletion must keep the durable job, even after SQL cascades.
  await db.query("DELETE FROM users WHERE id=$1", [b.id]);
  job = (await db.query("SELECT * FROM chat_jobs WHERE user_id=$1", [b.id]))
    .rows[0];
  assert.equal(job.kind, "delete");
  const failing = {
    ...provider,
    deleteUser: async () => {
      throw new Error("outage");
    },
  };
  await assert.rejects(db.transaction((q) => syncChatJob(q, job, failing)));
  assert.equal(
    (await db.query("SELECT * FROM chat_jobs WHERE user_id=$1", [b.id])).rows
      .length,
    1,
  );
  await db.transaction((q) => syncChatJob(q, job, provider));
  assert.equal(
    (await db.query("SELECT * FROM chat_jobs WHERE user_id=$1", [b.id])).rows
      .length,
    0,
  );
  assert.equal(provider.users.has(streamUserId(b.id)), false);
  assert.deepEqual(provider.calls.find((c) => c[0] === "delete")[2], {
    hard_delete: true,
    mark_messages_deleted: true,
    delete_conversation_channels: true,
  });
  // The outbox can be retried without the user row or remote identity.
  await db.transaction((q) => syncChatJob(q, job, provider));
  // External upsert and PostgreSQL are not one transaction. Deletion also
  // covers a vendor identity left behind by a rolled-back registration.
  const orphan = await person("Orphan");
  provider.users.set(streamUserId(orphan.id), { id: streamUserId(orphan.id) });
  await db.query("DELETE FROM users WHERE id=$1", [orphan.id]);
  job = (
    await db.query("SELECT * FROM chat_jobs WHERE user_id=$1", [orphan.id])
  ).rows[0];
  assert.equal(job.kind, "delete");
  await db.transaction((q) => syncChatJob(q, job, provider));
  assert.equal(provider.users.has(streamUserId(orphan.id)), false);
});
