import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { streamUserId } from "../lib/chat-config.ts";
import {
  chatMessagePush,
  chatWebhookSignatureOk,
  eventIdOfMessage,
  userIdOfStream,
} from "../lib/chat-push.ts";
import type {
  ChatPushAccess,
  ChatPushVerdict,
} from "../lib/chat-push-access.ts";
import { handleChatWebhook } from "../lib/chat-webhook.ts";
import { createDeviceSession } from "../lib/device-sessions.ts";
import { pushEnvelopeSchema } from "../lib/notification-envelope.ts";
import {
  notificationSettingsPatch,
  saveNotificationSettings,
} from "../lib/notification-settings.ts";
import { formatClock } from "../lib/notification-policy.ts";
import { runPushBatch } from "../lib/push-delivery.ts";
import { registerPushDevice, revokePushDevice } from "../lib/push-devices.ts";
import type {
  PushMessage,
  PushOutcome,
  PushTransport,
} from "../lib/push-transport.ts";
import { processEnv } from "./support/env.ts";
import { testDatabase } from "./support/database.ts";
import { userRow } from "./support/people.ts";

// New messages of Stream conversations as pushes (#342): the call of Stream is
// checked and remembered once, becomes references in the queue, and each send is
// preceded by a question to Stream. No text, no copy of the conversation.

const hour = 3600_000;
const secret = "stream-secret-for-tests";
const apiKey = "stream-key";
const env = processEnv({
  STREAM_CHAT_ENABLED: "true",
  STREAM_CHAT_API_KEY: apiKey,
  STREAM_CHAT_API_SECRET: secret,
  PUSH_TOKEN_KEY: randomBytes(32).toString("base64"),
  RUSTORE_PUSH_PROJECTS: "project-a",
  RUSTORE_PUSH_SERVICE_TOKEN: "service-secret",
});
const cid = "colabike:dm_3f1c0a9e7d5b4c2a8e6f1d0b9a7c5e3f2b4d6a8c";
const sign = (raw: string, key = secret) =>
  createHmac("sha256", key).update(raw).digest("hex");

function event(
  author: string,
  members: string[],
  overrides: Record<string, unknown> = {},
  message: Record<string, unknown> = {},
) {
  return {
    type: "message.new",
    cid,
    channel_type: "colabike",
    channel_id: cid.split(":")[1],
    message: {
      id: "msg-" + randomUUID(),
      type: "regular",
      text: "SECRET TEXT OF THE MESSAGE",
      user: { id: streamUserId(author) },
      ...message,
    },
    user: { id: streamUserId(author) },
    members: [author, ...members].map((id) => ({
      user_id: streamUserId(id),
      user: { id: streamUserId(id) },
    })),
    ...overrides,
  };
}

function transportOf(script: PushOutcome = { kind: "accepted" }) {
  const sent: PushMessage[] = [];
  const transport: PushTransport = {
    async send(message) {
      sent.push(message);
      return script;
    },
  };
  return { sent, transport };
}
function accessOf(answer: ChatPushVerdict | "outage" = "ok") {
  const asked: { cid: string; messageId: string; recipientId: string }[] = [];
  const access: ChatPushAccess = {
    async check(input) {
      asked.push(input);
      if (answer === "outage") throw new Error("stream is down");
      return answer;
    },
  };
  return { asked, access };
}

async function setup() {
  const db = await testDatabase();
  const person = await userRow(db, {
    email_verified_at: new Date(),
    name: "Анна Райдер",
  });
  const author = await userRow(db, {
    email_verified_at: new Date(),
    name: "Борис Автор",
  });
  const recipient = person.id;
  const session = (
    await createDeviceSession(
      db,
      recipient,
      { name: "Pixel", platform: "android", appVersion: "1.0" },
      "test",
    )
  ).sessionId;
  const address = "address-" + randomUUID();
  const save = (patch: unknown) =>
    saveNotificationSettings(
      db,
      recipient,
      notificationSettingsPatch.parse(patch),
      {
        env,
        pushReady: true,
      },
    );
  await db.transaction((q) =>
    registerPushDevice(
      q,
      {
        userId: recipient,
        sessionId: session,
        installationId: randomUUID(),
        provider: "rustore",
        projectId: "project-a",
        token: address,
      },
      env,
    ),
  );
  await save({ channels: { push: { enabled: true } } });
  const webhook = async (
    body: unknown,
    options: { id?: string; key?: string; signWith?: string; now?: Date } = {},
  ) => {
    const raw = JSON.stringify(body);
    return handleChatWebhook(
      new Request("https://colabike.test/api/chat/webhook", {
        method: "POST",
        headers: {
          "x-signature": sign(raw, options.signWith),
          "x-api-key": options.key ?? apiKey,
          "x-webhook-id": options.id ?? "hook-" + randomUUID(),
          "content-type": "application/json",
        },
        body: raw,
      }),
      { env, now: options.now, transaction: (work) => db.transaction(work) },
    );
  };
  const deliveries = async () =>
    (
      await db.query<{
        status: string;
        error_code: string | null;
        chat_message_id: string | null;
        chat_cid: string | null;
        chat_author_id: string | null;
        notification_id: string | null;
        attempts: number;
        available_at: Date;
      }>(
        "SELECT status,error_code,chat_message_id,chat_cid,chat_author_id,notification_id,attempts,available_at FROM push_deliveries ORDER BY created_at,id",
      )
    ).rows;
  return {
    db,
    recipient,
    author: author.id,
    session,
    address,
    save,
    webhook,
    deliveries,
  };
}

test("the signature is the HMAC of the raw body with the application's secret", () => {
  const raw = '{"type":"message.new"}';
  assert.equal(chatWebhookSignatureOk(raw, sign(raw), secret), true);
  assert.equal(chatWebhookSignatureOk(raw, sign(raw, "other"), secret), false);
  assert.equal(chatWebhookSignatureOk(raw + " ", sign(raw), secret), false);
  assert.equal(chatWebhookSignatureOk(raw, null, secret), false);
  assert.equal(chatWebhookSignatureOk(raw, "not-hex", secret), false);
  assert.equal(chatWebhookSignatureOk(raw, sign(raw).slice(2), secret), false);
});

test("a Stream user is one of ours only by the id we gave it; a message makes one stable event", () => {
  const id = randomUUID();
  assert.equal(userIdOfStream(streamUserId(id)), id);
  for (const bad of ["cola_xyz", "user-1", "cola_" + "0".repeat(31), null, 7])
    assert.equal(userIdOfStream(bad), null);
  const one = eventIdOfMessage("msg-1");
  assert.equal(one, eventIdOfMessage("msg-1"));
  assert.notEqual(one, eventIdOfMessage("msg-2"));
  assert.ok(pushEnvelopeSchema.shape.eventId.safeParse(one).success);
});

test("only a new message of our conversations, from a person to the others, is pushed", () => {
  const a = randomUUID(),
    b = randomUUID(),
    c = randomUUID();
  const ok = chatMessagePush(event(a, [b, c]));
  assert.deepEqual(ok?.recipients.sort(), [b, c].sort());
  assert.equal(ok?.authorId, a);
  assert.equal(ok?.cid, cid);
  // The author is not told of their own message; a muted or banned member is not told.
  const muted = event(a, [b]);
  muted.members.push({
    user_id: streamUserId(c),
    user: { id: streamUserId(c) },
    notifications_muted: true,
  } as never);
  assert.deepEqual(chatMessagePush(muted)?.recipients, [b]);
  // Not ours, not new, not a message to push.
  assert.equal(
    chatMessagePush(event(a, [b], { type: "message.updated" })),
    null,
  );
  assert.equal(
    chatMessagePush(event(a, [b], { channel_type: "messaging" })),
    null,
  );
  assert.equal(chatMessagePush(event(a, [b], { cid: "messaging:x" })), null);
  assert.equal(chatMessagePush(event(a, [b], {}, { type: "system" })), null);
  assert.equal(chatMessagePush(event(a, [b], {}, { type: "ephemeral" })), null);
  assert.equal(chatMessagePush(event(a, [b], {}, { skip_push: true })), null);
  assert.equal(chatMessagePush(event(a, [b], {}, { silent: true })), null);
  assert.equal(chatMessagePush(event(a, [], {})), null, "nobody to tell");
  assert.equal(
    chatMessagePush(event("someone-else", [b])),
    null,
    "an author that is not ours",
  );
  assert.equal(chatMessagePush({ nonsense: true }), null);
});

test("the webhook refuses what is not Stream's, and says nothing about why", async () => {
  const s = await setup();
  const body = event(s.author, [s.recipient]);
  const bad = [
    await s.webhook(body, { signWith: "other-secret" }),
    await s.webhook(body, { key: "other-key" }),
  ];
  for (const response of bad) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "unauthorized" });
  }
  assert.equal((await s.webhook(body, { id: "bad id!" })).status, 400);
  // Not configured: nothing to check a call against.
  const off = await handleChatWebhook(
    new Request("https://colabike.test/api/chat/webhook", {
      method: "POST",
      body: "{}",
    }),
    { env: processEnv(), transaction: (work) => s.db.transaction(work) },
  );
  assert.equal(off.status, 503);
  const get = await handleChatWebhook(
    new Request("https://colabike.test/api/chat/webhook"),
    { env, transaction: (work) => s.db.transaction(work) },
  );
  assert.equal(get.status, 405);
  // An oversized body is not read to the end.
  const huge = await handleChatWebhook(
    new Request("https://colabike.test/api/chat/webhook", {
      method: "POST",
      body: "x".repeat(300 * 1024),
    }),
    { env, transaction: (work) => s.db.transaction(work) },
  );
  assert.equal(huge.status, 413);
  assert.equal((await s.deliveries()).length, 0);
  await s.db.close();
});

test("a new message becomes references for the live devices of the people who said yes, once", async () => {
  const s = await setup();
  const body = event(s.author, [s.recipient]);
  const first = await s.webhook(body, { id: "hook-1" });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, queued: 1 });
  const [row] = await s.deliveries();
  assert.equal(row.status, "pending");
  assert.equal(row.chat_message_id, body.message.id);
  assert.equal(row.chat_cid, cid);
  assert.equal(row.chat_author_id, s.author);
  assert.equal(row.notification_id, null);
  // Stream retries the call, then the same message arrives under another call id.
  assert.deepEqual(await (await s.webhook(body, { id: "hook-1" })).json(), {
    ok: true,
    queued: 0,
  });
  assert.deepEqual(await (await s.webhook(body, { id: "hook-2" })).json(), {
    ok: true,
    queued: 0,
  });
  assert.equal((await s.deliveries()).length, 1);
  // Nothing of the message is kept anywhere in the queue or the memory of calls.
  const everything = JSON.stringify([
    (await s.db.query("SELECT * FROM push_deliveries")).rows,
    (await s.db.query("SELECT * FROM chat_webhooks")).rows,
  ]);
  assert.ok(!everything.includes("SECRET TEXT"));
  await s.db.close();
});

test("nothing is queued for push that is off, a revoked device, a blocked person or a message from before the consent", async () => {
  const off = await setup();
  await off.save({ channels: { push: { enabled: false } } });
  await off.webhook(event(off.author, [off.recipient]));
  assert.equal((await off.deliveries()).length, 0);
  await off.db.close();

  const s = await setup();
  await s.db.transaction((q) => revokePushDevice(q, s.session, "user"));
  await s.webhook(event(s.author, [s.recipient]));
  assert.equal((await s.deliveries()).length, 0);
  await s.db.close();

  const blocked = await setup();
  await blocked.db.query("UPDATE users SET blocked=true WHERE id=$1", [
    blocked.author,
  ]);
  await blocked.webhook(event(blocked.author, [blocked.recipient]));
  assert.equal(
    (await blocked.deliveries()).length,
    0,
    "an author that is blocked",
  );
  await blocked.db.close();

  const early = await setup();
  await early.webhook(event(early.author, [early.recipient]), {
    now: new Date(Date.now() - hour),
  });
  assert.equal(
    (await early.deliveries()).length,
    0,
    "before the device and the consent",
  );
  await early.db.close();
});

test("a newer message of a conversation replaces the older ones that have not left", async () => {
  const s = await setup();
  const first = event(s.author, [s.recipient]);
  const second = event(s.author, [s.recipient]);
  await s.webhook(first);
  await s.webhook(second);
  const rows = await s.deliveries();
  assert.deepEqual(
    rows.map((row) => [row.chat_message_id, row.status, row.error_code]),
    [
      [first.message.id, "skipped", "superseded"],
      [second.message.id, "pending", null],
    ],
  );
  await s.db.close();
});

test("a message is sent as the envelope of the contract after Stream has been asked", async () => {
  const s = await setup();
  const body = event(s.author, [s.recipient]);
  await s.webhook(body);
  const { sent, transport } = transportOf();
  const { asked, access } = accessOf("ok");
  const counts = await runPushBatch(s.db, { env, transport, chat: access });
  assert.equal(counts.sent, 1);
  assert.deepEqual(asked, [
    { cid, messageId: body.message.id, recipientId: s.recipient },
  ]);
  const envelope = pushEnvelopeSchema.parse(JSON.parse(sent[0].data));
  assert.equal(envelope.category, "chat");
  assert.equal(envelope.type, "chat_message");
  assert.equal(envelope.title, "Новое сообщение");
  assert.equal(envelope.body, "От: Борис Автор");
  assert.equal(envelope.target.type, "chat");
  assert.equal(envelope.target.ref, cid);
  assert.equal(envelope.target.id, null);
  assert.equal(envelope.group, "chat:" + cid);
  assert.equal(envelope.eventId, eventIdOfMessage(body.message.id));
  assert.equal(envelope.bindingGeneration, 1);
  assert.ok(!sent[0].data.includes("SECRET TEXT"));
  assert.ok(sent[0].ttlSeconds > 11 * 3600 && sent[0].ttlSeconds <= 12 * 3600);
  assert.equal((await s.deliveries())[0].status, "sent");
  await s.db.close();
});

test("what Stream says at the moment of the send decides: gone, left, muted or read elsewhere", async () => {
  for (const [verdict, code] of [
    ["gone", "gone"],
    ["not_member", "not_member"],
    ["muted", "muted"],
    ["read", "read"],
  ] as const) {
    const s = await setup();
    await s.webhook(event(s.author, [s.recipient]));
    const { sent, transport } = transportOf();
    await runPushBatch(s.db, {
      env,
      transport,
      chat: accessOf(verdict).access,
    });
    assert.equal(sent.length, 0, verdict);
    assert.deepEqual(
      [(await s.deliveries())[0].status, (await s.deliveries())[0].error_code],
      ["skipped", code],
    );
    await s.db.close();
  }
});

test("when Stream cannot answer nothing is sent unchecked: the message waits and goes later", async () => {
  const s = await setup();
  await s.webhook(event(s.author, [s.recipient]));
  const { sent, transport } = transportOf();
  const down = await runPushBatch(s.db, {
    env,
    transport,
    chat: accessOf("outage").access,
  });
  assert.equal(down.retry, 1);
  assert.equal(sent.length, 0);
  const [waiting] = await s.deliveries();
  assert.deepEqual(
    [waiting.status, waiting.error_code, waiting.attempts],
    ["pending", "provider_temporary", 1],
  );
  const later = new Date(Date.now() + 2 * 60_000);
  const up = await runPushBatch(s.db, {
    env,
    transport,
    chat: accessOf("ok").access,
    now: later,
  });
  assert.equal(up.sent, 1);
  await s.db.close();
});

test("the person's own choices apply to messages: category, pause, quiet hours and the admin's switches", async () => {
  // The category off drops what is queued, and a later yes does not bring it back.
  const s = await setup();
  const pending = event(s.author, [s.recipient]);
  await s.webhook(pending);
  await s.save({ categories: [{ key: "chat", push: false }] });
  assert.equal((await s.deliveries())[0].error_code, "preferences");
  await s.save({ categories: [{ key: "chat", push: true }] });
  const none = transportOf();
  await runPushBatch(s.db, {
    env,
    transport: none.transport,
    chat: accessOf().access,
  });
  assert.equal(none.sent.length, 0);
  // A pause drops it.
  await s.webhook(event(s.author, [s.recipient]));
  await s.save({ pausedUntil: new Date(Date.now() + 24 * hour).toISOString() });
  const paused = transportOf();
  await runPushBatch(s.db, {
    env,
    transport: paused.transport,
    chat: accessOf().access,
  });
  assert.equal(paused.sent.length, 0);
  assert.equal((await s.deliveries()).at(-1)?.error_code, "paused");
  await s.save({ pausedUntil: null });
  // The category switched off by the admin.
  await s.webhook(event(s.author, [s.recipient]));
  await s.db.query(
    "UPDATE notification_limits SET disabled_categories=ARRAY['chat']",
  );
  const disabled = transportOf();
  await runPushBatch(s.db, {
    env,
    transport: disabled.transport,
    chat: accessOf().access,
  });
  assert.equal(disabled.sent.length, 0);
  assert.equal((await s.deliveries()).at(-1)?.error_code, "disabled");
  await s.db.close();
});

test("in the quiet hours a message waits for their end", async () => {
  const s = await setup();
  const now = new Date();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  await s.save({
    timeZone: "UTC",
    quietHours: {
      enabled: true,
      from: formatClock((minutes + 1440 - 60) % 1440),
      to: formatClock((minutes + 120) % 1440),
    },
  });
  await s.webhook(event(s.author, [s.recipient]));
  const { sent, transport } = transportOf();
  // A moment after the webhook was taken.
  const at = new Date(Date.now() + 1000);
  const counts = await runPushBatch(s.db, {
    env,
    transport,
    chat: accessOf().access,
    now: at,
  });
  assert.equal(counts.deferred, 1);
  assert.equal(sent.length, 0);
  const late = await runPushBatch(s.db, {
    env,
    transport,
    chat: accessOf().access,
    now: new Date(at.getTime() + 3 * hour),
  });
  assert.equal(late.sent, 1);
  await s.db.close();
});

test("a blocked author, a deleted account and a revoked device take their messages with them", async () => {
  const s = await setup();
  await s.webhook(event(s.author, [s.recipient]));
  await s.db.query("UPDATE users SET blocked=true WHERE id=$1", [s.author]);
  const blocked = transportOf();
  await runPushBatch(s.db, {
    env,
    transport: blocked.transport,
    chat: accessOf().access,
  });
  assert.equal(blocked.sent.length, 0);
  assert.equal((await s.deliveries())[0].error_code, "unavailable");
  await s.db.query("UPDATE users SET blocked=false WHERE id=$1", [s.author]);
  await s.webhook(event(s.author, [s.recipient]));
  await s.db.query("DELETE FROM users WHERE id=$1", [s.author]);
  assert.equal(
    (await s.deliveries()).length,
    0,
    "the author's messages go with the author",
  );
  await s.db.close();
});
