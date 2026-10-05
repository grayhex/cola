import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createDeviceSession } from "../lib/device-sessions.ts";
import { pushEnvelopeSchema } from "../lib/notification-envelope.ts";
import {
  notificationSettingsPatch,
  saveNotificationSettings,
} from "../lib/notification-settings.ts";
import { formatClock } from "../lib/notification-policy.ts";
import {
  claimPushDeliveries,
  materializePushDeliveries,
  pushAttempts,
  pushStatus,
  runPushBatch,
} from "../lib/push-delivery.ts";
import {
  pushDeviceOf,
  registerPushDevice,
  revokePushDevice,
} from "../lib/push-devices.ts";
import type {
  PushMessage,
  PushOutcome,
  PushTransport,
} from "../lib/push-transport.ts";
import { processEnv } from "./support/env.ts";
import { testDatabase } from "./support/database.ts";
import { bikeCommentRow, noticeRow } from "./support/notifications.ts";
import { planRow } from "./support/rides.ts";
import { planInput, planRide, rideDefaults } from "../lib/rides.ts";
import { bikeRow } from "./support/bikes.ts";
import { userRow } from "./support/people.ts";

// The queue of pushes (#342): a message is made from a durable event for a live
// device of a person who said yes, and is read again before every attempt, so
// that what the person has since said, muted, read or revoked is what decides.

const hour = 3600_000;
const env = processEnv({
  PUSH_TOKEN_KEY: randomBytes(32).toString("base64"),
  RUSTORE_PUSH_PROJECTS: "project-a",
  RUSTORE_PUSH_SERVICE_TOKEN: "service-secret",
});

function transportOf(
  script: PushOutcome | ((message: PushMessage) => PushOutcome),
) {
  const sent: PushMessage[] = [];
  const transport: PushTransport = {
    async send(message) {
      sent.push(message);
      return typeof script === "function" ? script(message) : script;
    },
  };
  return { sent, transport };
}
const accepted: PushOutcome = { kind: "accepted" };

async function setup(options: { pushOn?: boolean; publicBike?: boolean } = {}) {
  const db = await testDatabase();
  const ownerRow = await userRow(db, { email_verified_at: new Date() });
  const owner = ownerRow.id;
  const actor = (await userRow(db, { email_verified_at: new Date() })).id;
  const bike = (
    await bikeRow(db, owner, {
      name: "Gravel Nuroad",
      is_public: options.publicBike ?? true,
    })
  ).id;
  const session = (
    await createDeviceSession(
      db,
      owner,
      { name: "Pixel", platform: "android", appVersion: "1.0" },
      "test",
    )
  ).sessionId;
  const address = "address-" + randomUUID();
  const save = (patch: unknown, id = owner) =>
    saveNotificationSettings(db, id, notificationSettingsPatch.parse(patch), {
      env,
      pushReady: true,
    });
  const register = (sessionId = session, userId = owner, token = address) =>
    db.transaction((q) =>
      registerPushDevice(
        q,
        {
          userId,
          sessionId,
          installationId: randomUUID(),
          provider: "rustore",
          projectId: "project-a",
          token,
        },
        env,
      ),
    );
  await register();
  if (options.pushOn !== false)
    await save({ channels: { push: { enabled: true } } });
  // A comment under the bike of the recipient, by someone else.
  const comment = async (recipient = owner, bikeId = bike) => {
    const body = await bikeCommentRow(db, bikeId, actor, {
      body: "SECRET TEXT OF THE COMMENT",
    });
    return (
      await noticeRow(db, recipient, "comment", {
        actor_id: actor,
        bike_id: bikeId,
        comment_id: body.id,
      })
    ).id;
  };
  // An invitation to a plan of someone else, public or closed.
  const invite = async (isPublic: boolean) => {
    const organizer = (await userRow(db, { email_verified_at: new Date() })).id;
    const organizerBike = (await bikeRow(db, organizer)).id;
    await db.transaction((q) =>
      planRide(
        q,
        organizer,
        planInput.parse({
          bikeId: organizerBike,
          title: "Субботний круг",
          scheduledAt: new Date(
            Math.floor((Date.now() + 48 * hour) / 60000) * 60000,
          ).toISOString(),
          isPublic,
          privacyEnabled: true,
          privacyRadiusM: 500,
          meetingPoint: "SECRET HOME",
          passport: {
            area: { label: "Москва" },
            purpose: "social",
            pace: "relaxed",
          },
          invitations: [ownerRow.username],
        }),
        rideDefaults,
      ),
    );
  };
  const deliveries = async () =>
    (
      await db.query<{
        notification_id: string;
        status: string;
        error_code: string | null;
        attempts: number;
        generation: number;
        available_at: Date;
        expires_at: Date;
        device_session_id: string;
      }>(
        "SELECT notification_id,status,error_code,attempts,generation,available_at,expires_at,device_session_id FROM push_deliveries ORDER BY created_at,id",
      )
    ).rows;
  const run = (transport: PushTransport | null, now = new Date()) =>
    runPushBatch(db, { env, transport, now });
  return {
    db,
    owner,
    actor,
    bike,
    session,
    address,
    save,
    register,
    comment,
    invite,
    deliveries,
    run,
  };
}

test("a message is made for a live device of a person who said yes, from an event made after both", async () => {
  const s = await setup();
  const id = await s.comment();
  assert.equal(await materializePushDeliveries(s.db), 1);
  const [row] = await s.deliveries();
  assert.equal(row.notification_id, id);
  assert.equal(row.status, "pending");
  assert.equal(row.generation, 1);
  // Comments are worth a day.
  const worth = new Date(row.expires_at).getTime() - Date.now();
  assert.ok(worth > 23 * hour && worth <= 24 * hour);
  // Again changes nothing.
  assert.equal(await materializePushDeliveries(s.db), 0);
  await s.db.close();
});

test("nothing is made for push that is off, a device that is not live, a kind push does not carry, a read or a late event", async () => {
  const off = await setup({ pushOn: false });
  await off.comment();
  assert.equal(await materializePushDeliveries(off.db), 0);
  await off.db.close();

  const s = await setup();
  // A follow is shown in the bell and nowhere else.
  await noticeRow(s.db, s.owner, "follow", { actor_id: s.actor });
  // A read one.
  const read = await s.comment();
  await s.db.query("UPDATE notifications SET read_at=now() WHERE id=$1", [
    read,
  ]);
  // One the discovery budget kept on the site.
  const budget = await s.comment();
  await s.db.query("UPDATE notifications SET external=false WHERE id=$1", [
    budget,
  ]);
  // One older than the push consent.
  const older = await s.comment();
  await s.db.query(
    "UPDATE notifications SET created_at=now()-interval '1 hour' WHERE id=$1",
    [older],
  );
  await s.db.query(
    "UPDATE notification_settings SET push_enabled_at=now()-interval '10 minutes'",
  );
  assert.equal(await materializePushDeliveries(s.db), 0);
  // A device that was revoked, a person who is blocked.
  const live = await s.comment();
  await s.db.transaction((q) => revokePushDevice(q, s.session, "user"));
  assert.equal(await materializePushDeliveries(s.db), 0);
  await s.register();
  const again = await s.comment();
  assert.equal(await materializePushDeliveries(s.db), 1);
  await s.db.query("UPDATE users SET blocked=true WHERE id=$1", [s.owner]);
  void live;
  void again;
  const other = await s.comment();
  void other;
  assert.equal(await materializePushDeliveries(s.db), 0);
  await s.db.close();
});

test("an event made before the device was bound is not caught up, and the work is not starved by what is already queued", async () => {
  const s = await setup();
  const before = await s.comment();
  await s.db.query(
    "UPDATE notifications SET created_at=now()-interval '1 minute' WHERE id=$1",
    [before],
  );
  await s.db.query(
    "UPDATE push_devices SET registered_at=now()-interval '30 seconds'",
  );
  await s.db.query(
    "UPDATE notification_settings SET push_enabled_at=now()-interval '2 hours'",
  );
  for (let index = 0; index < 5; index++) await s.comment();
  // Two at a time: the second pass takes the next two, not the same ones again.
  assert.equal(await materializePushDeliveries(s.db, new Date(), 2), 2);
  assert.equal(await materializePushDeliveries(s.db, new Date(), 2), 2);
  assert.equal(await materializePushDeliveries(s.db, new Date(), 2), 1);
  assert.equal(await materializePushDeliveries(s.db, new Date(), 2), 0);
  assert.ok(
    !(await s.deliveries()).some((row) => row.notification_id === before),
  );
  await s.db.close();
});

test("a message is sent as the envelope of the contract: neutral about the private, no text of a comment, the address opened for the provider only", async () => {
  const pub = await setup();
  const id = await pub.comment();
  const { sent, transport } = transportOf(accepted);
  const counts = await pub.run(transport);
  assert.equal(counts.sent, 1);
  assert.equal(sent.length, 1);
  const [message] = sent;
  assert.equal(message.token, pub.address);
  assert.equal(message.projectId, "project-a");
  assert.ok(message.ttlSeconds > 23 * 3600 && message.ttlSeconds <= 24 * 3600);
  const envelope = pushEnvelopeSchema.parse(JSON.parse(message.data));
  assert.equal(envelope.eventId, id);
  assert.equal(envelope.bindingGeneration, 1);
  assert.equal(envelope.neutral, false);
  assert.equal(envelope.body, "К велосипеду «Gravel Nuroad»");
  assert.equal(envelope.target.type, "bike");
  assert.ok(envelope.target.commentId);
  assert.ok(!message.data.includes("SECRET TEXT"));
  assert.ok(!message.data.includes(pub.address));
  assert.equal((await pub.deliveries())[0].status, "sent");
  await pub.db.close();

  // An invitation to a public plan names it; one to a closed plan names nothing.
  const rides = await setup();
  await rides.invite(true);
  await rides.invite(false);
  const invited = transportOf(accepted);
  await rides.run(invited.transport);
  assert.equal(invited.sent.length, 2);
  const envelopes = invited.sent.map((message) =>
    pushEnvelopeSchema.parse(JSON.parse(message.data)),
  );
  const open = envelopes.find((item) => !item.neutral);
  const closed = envelopes.find((item) => item.neutral);
  assert.ok(open && closed);
  assert.equal(open.type, "ride_invite");
  assert.equal(open.title, "Приглашение на покатушку");
  assert.equal(open.body, "«Субботний круг»");
  assert.equal(open.target.type, "ride");
  assert.ok(open.target.occurrenceAt);
  assert.equal(closed.body, "Откройте ColaBike, чтобы посмотреть детали");
  for (const message of invited.sent) {
    assert.ok(!message.data.includes("SECRET HOME"));
    assert.ok(!message.data.includes("Москва"));
  }
  assert.ok(
    !invited.sent
      .find((message) => message.data.includes(closed.eventId))
      ?.data.includes("Субботний круг"),
  );
  // An invitation does not outlive its date.
  assert.ok(new Date(open.expiresAt) < new Date(Date.now() + 49 * hour));
  await rides.db.close();
});

test("what the person says after the message was made decides: push off, a category off, read, muted, paused", async () => {
  const s = await setup();
  const off = await s.comment();
  await materializePushDeliveries(s.db);
  await s.save({ channels: { push: { enabled: false } } });
  // Switching push off drops what was made; switching it on does not bring it back.
  await s.save({ channels: { push: { enabled: true } } });
  const first = transportOf(accepted);
  await s.run(first.transport);
  assert.equal(first.sent.length, 0);
  assert.deepEqual(
    (await s.deliveries()).map((row) => [
      row.notification_id,
      row.status,
      row.error_code,
    ]),
    [[off, "skipped", "preferences"]],
  );

  // A category off drops only its own messages.
  const comment = await s.comment();
  await materializePushDeliveries(s.db);
  await s.save({ categories: [{ key: "discussions", push: false }] });
  assert.equal(
    (await s.deliveries()).find((row) => row.notification_id === comment)
      ?.error_code,
    "preferences",
  );
  await s.save({ categories: [{ key: "discussions", push: true }] });

  // Read in between.
  const read = await s.comment();
  await materializePushDeliveries(s.db);
  await s.db.query("UPDATE notifications SET read_at=now() WHERE id=$1", [
    read,
  ]);
  const second = transportOf(accepted);
  await s.run(second.transport);
  assert.equal(second.sent.length, 0);
  assert.equal(
    (await s.deliveries()).find((row) => row.notification_id === read)
      ?.error_code,
    "unavailable",
  );

  // Muted in between: the author.
  const muted = await s.comment();
  await materializePushDeliveries(s.db);
  await s.save({ mutes: { add: [{ kind: "author", id: s.actor }] } });
  const third = transportOf(accepted);
  await s.run(third.transport);
  assert.equal(third.sent.length, 0);
  assert.equal(
    (await s.deliveries()).find((row) => row.notification_id === muted)
      ?.error_code,
    "muted",
  );
  await s.save({ mutes: { remove: [{ kind: "author", id: s.actor }] } });

  // A pause.
  const paused = await s.comment();
  await materializePushDeliveries(s.db);
  await s.save({ pausedUntil: new Date(Date.now() + 24 * hour).toISOString() });
  const fourth = transportOf(accepted);
  await s.run(fourth.transport);
  assert.equal(fourth.sent.length, 0);
  assert.equal(
    (await s.deliveries()).find((row) => row.notification_id === paused)
      ?.error_code,
    "paused",
  );
  await s.db.close();
});

test("in the quiet hours a message waits without using an attempt, and goes at their end", async () => {
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
  await s.comment();
  const early = transportOf(accepted);
  const first = await s.run(early.transport, now);
  assert.equal(first.deferred, 1);
  assert.equal(early.sent.length, 0);
  const [waiting] = await s.deliveries();
  assert.equal(waiting.status, "pending");
  assert.equal(waiting.attempts, 0);
  assert.ok(new Date(waiting.available_at) > now);
  // Asked again inside the window, nothing happens; after it, it goes.
  const same = transportOf(accepted);
  assert.equal(
    (await s.run(same.transport, new Date(now.getTime() + hour))).claimed,
    0,
  );
  const late = await s.run(same.transport, new Date(now.getTime() + 3 * hour));
  assert.equal(late.sent, 1);
  await s.db.close();
});

test("the admin's switches stop the channel without touching the bell or e-mail", async () => {
  const s = await setup();
  await s.comment();
  await s.db.query("UPDATE notification_limits SET push_enabled=false");
  const off = transportOf(accepted);
  const none = await s.run(off.transport);
  assert.equal(none.materialized, 0);
  assert.equal(off.sent.length, 0);
  // What was queued before the switch is dropped at its turn, not sent.
  await s.db.query("UPDATE notification_limits SET push_enabled=true");
  await s.run(transportOf(accepted).transport);
  await s.comment();
  await materializePushDeliveries(s.db);
  await s.db.query("UPDATE notification_limits SET external_enabled=false");
  const stopped = transportOf(accepted);
  await s.run(stopped.transport);
  assert.equal(stopped.sent.length, 0);
  assert.equal((await s.deliveries()).at(-1)?.error_code, "disabled");
  await s.db.close();
});

test("a message is for one generation of one live registration", async () => {
  const s = await setup();
  await s.comment();
  await materializePushDeliveries(s.db);
  // The address rotates: the generation moves on, the old message is dropped.
  await s.register(s.session, s.owner, "rotated-" + randomUUID());
  const sent = transportOf(accepted);
  await s.run(sent.transport);
  assert.equal(sent.sent.length, 0);
  assert.equal((await s.deliveries())[0].error_code, "rebound");

  // A message already claimed when the device is revoked goes nowhere.
  await s.comment();
  await materializePushDeliveries(s.db);
  const [job] = await claimPushDeliveries(s.db);
  assert.ok(job);
  await s.db.transaction((q) => revokePushDevice(q, s.session, "user"));
  const none = transportOf(accepted);
  await s.run(none.transport);
  assert.equal(none.sent.length, 0);
  assert.equal(await pushDeviceOf(s.db, s.session), null);
  // A session that ended takes the registry and the queue with it.
  await s.register();
  await s.comment();
  await materializePushDeliveries(s.db);
  await s.db.query("DELETE FROM sessions WHERE id=$1", [s.session]);
  assert.equal(
    (await s.deliveries()).filter((row) => row.status === "pending").length,
    0,
  );
  await s.db.close();
});

test("a temporary failure is tried again with backoff, until the attempts are used", async () => {
  const s = await setup();
  await s.comment();
  const failing = transportOf({ kind: "temporary" });
  const start = new Date();
  const first = await s.run(failing.transport, start);
  assert.equal(first.retry, 1);
  const [retried] = await s.deliveries();
  assert.equal(retried.status, "pending");
  assert.equal(retried.error_code, "provider_temporary");
  assert.equal(retried.attempts, 1);
  // Not before the backoff.
  assert.equal(
    (await s.run(failing.transport, new Date(start.getTime() + 30_000)))
      .claimed,
    0,
  );
  let at = start.getTime();
  for (let attempt = 2; attempt < pushAttempts; attempt++) {
    at += 3600_000;
    assert.equal((await s.run(failing.transport, new Date(at))).retry, 1);
  }
  at += 3600_000;
  const last = await s.run(failing.transport, new Date(at));
  assert.equal(last.failed, 1);
  const [done] = await s.deliveries();
  assert.deepEqual(
    [done.status, done.error_code, done.attempts],
    ["failed", "attempts_exhausted", pushAttempts],
  );
  // A provider that asks to wait is waited for (within an hour).
  const slow = await setup();
  await slow.comment();
  const throttled = transportOf({ kind: "temporary", retryAfterSeconds: 1800 });
  const when = new Date();
  await slow.run(throttled.transport, when);
  const [row] = await slow.deliveries();
  assert.ok(
    new Date(row.available_at).getTime() - when.getTime() >= 1800_000 - 1000,
  );
  // A transport that throws is a timeout.
  const crashing = await setup();
  await crashing.comment();
  const thrown: PushTransport = {
    async send() {
      throw new Error("socket hang up");
    },
  };
  assert.equal((await crashing.run(thrown)).retry, 1);
  await s.db.close();
  await slow.db.close();
  await crashing.db.close();
});

test("an address the provider has dropped stops that device, not the person; a wrong key of the server stops no device at all", async () => {
  const s = await setup();
  const second = await createDeviceSession(
    s.db,
    s.owner,
    { name: "Tablet", platform: "android", appVersion: "1.0" },
    "test",
  );
  await s.register(second.sessionId, s.owner, "tablet-" + randomUUID());
  await s.comment();
  // The first device's address is gone, the second takes the message.
  const dropped = transportOf((message) =>
    message.token === s.address ? { kind: "invalid_token" } : accepted,
  );
  const counts = await s.run(dropped.transport);
  assert.equal(counts.revoked, 1);
  assert.equal(counts.sent, 1);
  assert.equal(await pushDeviceOf(s.db, s.session), null);
  assert.ok(await pushDeviceOf(s.db, second.sessionId));

  // The server's own key is refused: wait, spend no attempt, forget no device, stop the batch.
  await s.comment();
  await s.comment();
  const refused = transportOf({ kind: "auth" });
  const stopped = await s.run(refused.transport);
  assert.equal(stopped.authFailures, 1);
  assert.equal(
    refused.sent.length,
    1,
    "the batch stopped at the first refusal",
  );
  assert.ok(await pushDeviceOf(s.db, second.sessionId));
  const waiting = (await s.deliveries()).filter(
    (row) => row.error_code === "provider_auth",
  );
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].attempts, 0);
  assert.equal(waiting[0].status, "pending");

  // A message the provider will never take fails for good.
  const rejecting = await setup();
  await rejecting.comment();
  const refusal = await rejecting.run(
    transportOf({ kind: "rejected" }).transport,
  );
  assert.equal(refusal.failed, 1);
  await s.db.close();
  await rejecting.db.close();
});

test("without a configuration or a transport nothing is made and nothing is sent", async () => {
  const s = await setup();
  await s.comment();
  const counts = await runPushBatch(s.db, {
    env: processEnv(),
    transport: transportOf(accepted).transport,
  });
  assert.equal(counts.disabled, true);
  assert.equal(
    (await runPushBatch(s.db, { env, transport: null })).disabled,
    true,
  );
  assert.equal((await s.deliveries()).length, 0);
  // What waits past its time is closed, not kept for ever.
  await materializePushDeliveries(s.db);
  await s.db.query(
    "UPDATE push_deliveries SET expires_at=now()-interval '1 minute'",
  );
  await runPushBatch(s.db, { env: processEnv(), transport: null });
  assert.equal((await s.deliveries())[0].error_code, "expired");
  await s.db.close();
});

test("a person's own affairs go before what others plan", async () => {
  const s = await setup();
  const friend = s.actor;
  const friendBike = (await bikeRow(s.db, friend)).id;
  const ride = await planRow(
    s.db,
    friend,
    friendBike,
    new Date(Date.now() + 72 * hour),
  );
  // The friend's plan is older than the comment.
  const plan = (
    await noticeRow(s.db, s.owner, "plan_published", {
      actor_id: friend,
      ride_id: ride.id,
      group_key: "plan:" + ride.id,
      event_occurs_at: new Date(Date.now() + 72 * hour),
      event_revision: 1,
    })
  ).id;
  await s.db.query(
    "UPDATE notifications SET created_at=now()-interval '1 minute' WHERE id=$1",
    [plan],
  );
  const comment = await s.comment();
  // The phone was bound, and push switched on, before either event.
  await s.db.query(
    "UPDATE push_devices SET registered_at=now()-interval '1 hour'",
  );
  await s.db.query(
    "UPDATE notification_settings SET push_enabled_at=now()-interval '1 hour'",
  );
  assert.equal(await materializePushDeliveries(s.db), 2);
  const first = await claimPushDeliveries(s.db);
  assert.equal(first[0].notification_id, comment);
  const next = await claimPushDeliveries(s.db);
  assert.equal(next[0].notification_id, plan);
  await s.db.close();
});

test("the status says counts and ages, and nothing about people or addresses", async () => {
  const s = await setup();
  await s.comment();
  await materializePushDeliveries(s.db);
  const status = await pushStatus(s.db);
  assert.deepEqual(status.devices, [{ provider: "rustore", count: 1 }]);
  assert.equal(status.deliveries[0].status, "pending");
  assert.ok(!JSON.stringify(status).includes(s.address));
  await s.db.close();
});
