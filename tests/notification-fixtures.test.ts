import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { toNotificationSettings } from "../lib/api-v1/mappers.ts";
import {
  errorSchema,
  notificationCountSchema,
  notificationReadAllRequestSchema,
  notificationReadRequestSchema,
  notificationReadResultSchema,
  notificationSchema,
  notificationSettingsSchema,
} from "../lib/api-v1/schemas.ts";
import { notificationTypes } from "../lib/notification-catalog.ts";
import {
  ENVELOPE_MAX_BYTES,
  envelopeBytes,
  pushEnvelopeSchema,
} from "../lib/notification-envelope.ts";
import {
  notificationSettings,
  notificationSettingsPatch,
  saveNotificationSettings,
} from "../lib/notification-settings.ts";
import { decodeWatermark } from "../lib/notifications.ts";
import {
  droppedEnvelopes,
  fixtureDirectory,
  ids,
  payloadFile,
  preferencesFile,
  readFile as readStateFile,
  targetCases,
  targetsFile,
  toleratedEnvelopes,
  validEnvelopes,
  watermarkExample,
  watermarkPosition,
} from "./support/notification-fixtures.ts";
import { testDatabase } from "./support/database.ts";
import { processEnv } from "./support/env.ts";
import { userRow } from "./support/people.ts";
import { bikeRow } from "./support/bikes.ts";
import { rideRow } from "./support/rides.ts";

// The published fixtures of the notification contract (#341): docs/contracts/
// notifications/v1. They are made from tests/support/notification-fixtures.ts;
// a change of the contract that makes them stale fails here, and
// UPDATE_NOTIFICATION_FIXTURES=1 writes them again (then run prettier on them).

const db = await testDatabase();
after(() => db.close());

const files = {
  "targets.json": targetsFile(),
  "payload.json": payloadFile(),
  "preferences.json": preferencesFile(),
  "read.json": readStateFile(),
};

test("the published files are what the code makes", async (t) => {
  for (const [name, expected] of Object.entries(files)) {
    const file = path.join(fixtureDirectory, name);
    if (process.env.UPDATE_NOTIFICATION_FIXTURES === "1") {
      await writeFile(file, JSON.stringify(expected, null, 2) + "\n");
      continue;
    }
    await t.test(name, async () => {
      const actual: unknown = JSON.parse(await readFile(file, "utf8"));
      assert.deepEqual(
        actual,
        JSON.parse(JSON.stringify(expected)),
        `${name} is stale: run UPDATE_NOTIFICATION_FIXTURES=1 node --test tests/notification-fixtures.test.ts, then prettier --write docs/contracts`,
      );
    });
  }
});

// ---- targets ---------------------------------------------------------------
test("targets: every kind of notice has an example, and each is what the API contract accepts", () => {
  const file = targetsFile();
  assert.deepEqual(
    [...new Set(targetCases.map((c) => c.row.type))].sort(),
    [...notificationTypes].sort(),
    "an example for every type the server makes",
  );
  for (const { name, notification } of file.cases) {
    assert.deepEqual(
      notificationSchema.parse(notification),
      notification,
      name,
    );
  }
  const by = Object.fromEntries(
    file.cases.map((c) => [c.name, c.notification]),
  );
  assert.equal(by.ride_invite.target.agreementRevision, 1);
  assert.ok(by.ride_changed.target.occurrenceAt);
  assert.equal(by.ride_invite_historical.target.occurrenceAt, null);
  assert.equal(by.article_comment.type, "article_comment");
  assert.equal(by.article_comment.category, "discussions");
  assert.equal(
    by.bike_comment.target.commentId,
    by.bike_comment.target.commentId,
  );
  assert.notEqual(by.bike_comment.target.commentId, null);
  assert.equal(by.market_expiring.target.state, "expiring");
});

// ---- payload ---------------------------------------------------------------
test("payload: the envelopes the server may send are valid, small, and carry no way in", () => {
  for (const { name, envelope } of validEnvelopes) {
    assert.deepEqual(pushEnvelopeSchema.parse(envelope), envelope, name);
    assert.ok(envelopeBytes(envelope) <= ENVELOPE_MAX_BYTES, name);
    assert.ok(Date.parse(envelope.expiresAt) > Date.parse(envelope.createdAt));
    // A way in would be an address, a token, a place or the text of a message.
    assert.doesNotMatch(
      JSON.stringify(envelope),
      /@|token|email|password|lat|lng|longitude|latitude|\/api\//i,
      name,
    );
    // A target is an object (id) or, for a conversation, its Stream cid (ref).
    assert.equal(
      envelope.target.id !== null || !!envelope.target.ref,
      true,
      name,
    );
  }
  // The text of an event about something closed names nothing.
  const closed = validEnvelopes.find((e) => e.name.includes("closed"));
  assert.equal(closed?.envelope.neutral, true);
  assert.doesNotMatch(closed?.envelope.body ?? "", /«|»|\d{1,2}:\d{2}/);
});

test("payload: the largest possible envelope still fits with room to spare", () => {
  const widest = pushEnvelopeSchema.parse({
    ...validEnvelopes[0].envelope,
    type: "x".repeat(40),
    title: "я".repeat(80),
    body: "я".repeat(160),
    group: "g".repeat(80),
    target: {
      type: "y".repeat(20),
      id: validEnvelopes[0].envelope.target.id,
      commentId: validEnvelopes[0].envelope.eventId,
      occurrenceAt: "2026-10-10T07:00:00.000Z",
      agreementRevision: 2_147_483_647,
    },
  });
  assert.ok(
    envelopeBytes(widest) <= ENVELOPE_MAX_BYTES,
    String(envelopeBytes(widest)),
  );
  assert.ok(ENVELOPE_MAX_BYTES < 4096, "the transport's own fields need room");
});

test("payload: what the app must drop is wrong for a stated reason, what it must tolerate is not", () => {
  for (const item of droppedEnvelopes) {
    const schemaFails = !pushEnvelopeSchema.safeParse(item.envelope).success;
    const expired =
      item.now !== undefined &&
      Date.parse(item.now) > Date.parse(String(item.envelope.expiresAt));
    const otherBinding =
      item.clientBindingGeneration !== undefined &&
      item.clientBindingGeneration !== item.envelope.bindingGeneration;
    assert.ok(schemaFails || expired || otherBinding, item.name);
    assert.ok(item.reason.length > 20, item.name);
  }
  for (const item of toleratedEnvelopes) {
    // Not the server's: its schema is strict. The app still shows them.
    const { v, deliveryId, eventId } = item.envelope;
    assert.equal(v, 1, item.name);
    assert.ok(deliveryId && eventId, item.name);
  }
  assert.deepEqual(
    droppedEnvelopes.map((item) => item.name),
    [
      "unsupported_version",
      "expired",
      "other_binding",
      "text_too_long",
      "no_target",
      "not_a_uuid",
    ],
  );
});

test("payload: an envelope says the same as the notice it is about", () => {
  const byId = new Map(
    targetsFile().cases.map((c) => [c.notification.id, c.notification]),
  );
  for (const { name, envelope } of validEnvelopes) {
    // A message of a conversation has no row in the bell: Stream keeps what is unread.
    if (envelope.type === "chat_message") continue;
    const notice = byId.get(envelope.eventId);
    assert.ok(notice, name + ": a notice of the targets file");
    assert.equal(notice.type, envelope.type, name);
    assert.equal(notice.category, envelope.category, name);
    assert.equal(notice.target.type, envelope.target.type, name);
    assert.equal(notice.target.id, envelope.target.id, name);
    assert.equal(notice.target.commentId, envelope.target.commentId, name);
    assert.equal(
      notice.target.occurrenceAt,
      envelope.target.occurrenceAt,
      name,
    );
    assert.equal(
      notice.target.agreementRevision,
      envelope.target.agreementRevision,
      name,
    );
  }
});

// ---- preferences -----------------------------------------------------------
test("preferences: bodies, requests and errors are what the contract says", () => {
  for (const item of preferencesFile().cases) {
    const { response } = item;
    if (response.status === 200)
      assert.deepEqual(
        notificationSettingsSchema.parse(response.body),
        response.body,
        item.name,
      );
    else
      assert.deepEqual(
        errorSchema.parse(response.body),
        response.body,
        item.name,
      );
    const body =
      "request" in item && item.request && "body" in item.request
        ? item.request.body
        : undefined;
    if (body !== undefined) {
      const parsed = notificationSettingsPatch.safeParse(body);
      if (item.name === "channel_cannot_carry_category") {
        assert.equal(parsed.success, false);
        const detail = (
          response.body as { error: { details?: { path: string }[] } }
        ).error.details?.[0];
        assert.ok(!parsed.success);
        assert.equal(
          parsed.error.issues[0].path.join("."),
          detail?.path,
          "the example names the field the server names",
        );
      } else assert.equal(parsed.success, true, item.name);
    }
  }
});

test("preferences: the examples are what the service answers", async () => {
  const mail = processEnv({ MAIL_CAPTURE_DIR: "/tmp/cola-fixtures-test" });
  const fresh = async () =>
    (await userRow(db, { email_verified_at: new Date() })).id;
  const view = (
    settings: Awaited<ReturnType<typeof notificationSettings>>,
  ) => ({
    ...toNotificationSettings(settings),
    updatedAt: null,
  });
  const cases = Object.fromEntries(
    preferencesFile().cases.map((item) => [item.name, item]),
  );
  const id = await fresh();
  assert.deepEqual(view(await notificationSettings(db, id, { env: mail })), {
    ...cases.defaults_push_not_connected.response.body,
    updatedAt: null,
  });
  const enabled = cases.enable_email_for_rides;
  assert.ok(enabled.request && "body" in enabled.request);
  const saved = await saveNotificationSettings(
    db,
    id,
    notificationSettingsPatch.parse(enabled.request.body),
    { env: mail },
  );
  assert.deepEqual(view(saved), {
    ...(enabled.response.body as object),
    updatedAt: null,
  });
  const off = cases.reminders_off;
  assert.ok(off.request && "body" in off.request);
  assert.deepEqual(
    view(
      await saveNotificationSettings(
        db,
        id,
        notificationSettingsPatch.parse(off.request.body),
        { env: mail },
      ),
    ),
    { ...(off.response.body as object), updatedAt: null },
  );
  // The errors the examples show are the ones the service raises.
  for (const [name, status, verified] of [
    ["push_not_connected", 503, true],
    ["email_not_verified", 403, false],
  ] as const) {
    const item = cases[name];
    assert.ok(item.request && "body" in item.request, name);
    const who = (
      await userRow(db, { email_verified_at: verified ? new Date() : null })
    ).id;
    await assert.rejects(
      saveNotificationSettings(
        db,
        who,
        notificationSettingsPatch.parse(item.request.body),
        { env: mail },
      ),
      (error: Error & { status?: number }) =>
        error.status === status &&
        error.message ===
          (item.response.body as { error: { message: string } }).error.message,
      name,
    );
  }
});

test("preferences: the policy examples are what the service answers", async () => {
  const mail = processEnv({ MAIL_CAPTURE_DIR: "/tmp/cola-fixtures-test" });
  const cases = Object.fromEntries(
    preferencesFile().cases.map((item) => [item.name, item]),
  );
  // The examples speak of fixed people and rides; the service of real ones.
  const friend = await userRow(db, { name: "Борис", username: "boris" });
  const owner = await userRow(db);
  const bike = await bikeRow(db, owner.id);
  const ride = await rideRow(db, owner.id, bike.id, { title: "Вечерний круг" });
  const real = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value)
        .replaceAll(ids.boris, friend.id)
        .replaceAll(ids.ride, ride.id),
    );
  const body = (name: string) => {
    const item = cases[name];
    assert.ok(item.request && "body" in item.request, name);
    return notificationSettingsPatch.parse(real(item.request.body));
  };
  // Mutes made in one request share a time; the example lists them by kind.
  const byKind = <T extends { mutes: { kind: string }[] }>(body: T): T => ({
    ...body,
    mutes: [...body.mutes].sort((a, b) => a.kind.localeCompare(b.kind)),
  });
  const view = (settings: Awaited<ReturnType<typeof notificationSettings>>) =>
    byKind({ ...toNotificationSettings(settings), updatedAt: null });
  const expected = (name: string) =>
    byKind({
      ...real((cases[name].response as { body: object }).body),
      updatedAt: null,
    });
  const who = async () =>
    (await userRow(db, { email_verified_at: new Date() })).id;

  for (const name of [
    "quiet_hours",
    "close_cancellation_breaks_quiet",
    "pause",
    "circle_selected",
    "mute_author_and_ride",
  ]) {
    const id = await who();
    // The pause of the example lies in the future of the example's clock.
    const now = new Date("2026-10-04T09:00:00Z");
    assert.deepEqual(
      view(
        await saveNotificationSettings(db, id, body(name), { env: mail, now }),
      ),
      expected(name),
      name,
    );
  }
  const id = await who();
  const refused = cases.quiet_hours_need_a_zone;
  await assert.rejects(
    saveNotificationSettings(db, id, body("quiet_hours_need_a_zone"), {
      env: mail,
    }),
    (error: Error & { status?: number }) =>
      error.status === 400 &&
      error.message ===
        (refused.response.body as { error: { message: string } }).error.message,
  );
});

// ---- read-state ------------------------------------------------------------
test("read-state: bodies and requests are what the contract says, and the watermark is the server's", () => {
  const cases = Object.fromEntries(
    readStateFile().cases.map((item) => [item.name, item]),
  );
  const body = (name: string) =>
    (cases[name].response as { body: unknown }).body;
  assert.deepEqual(
    notificationCountSchema.parse(body("count_with_watermark")),
    body("count_with_watermark"),
  );
  for (const name of [
    "mark_one",
    "mark_one_again",
    "mark_selection",
    "read_all",
    "read_all_in_category",
  ])
    assert.deepEqual(
      notificationReadResultSchema.parse(body(name)),
      body(name),
      name,
    );
  assert.deepEqual(
    notificationReadRequestSchema.parse(
      (cases.mark_selection.request as { body: unknown }).body,
    ),
    (cases.mark_selection.request as { body: unknown }).body,
  );
  for (const name of ["read_all", "read_all_in_category"])
    assert.equal(
      notificationReadAllRequestSchema.safeParse(
        (cases[name].request as { body: unknown }).body,
      ).success,
      true,
      name,
    );
  for (const name of ["not_my_notification", "unknown_watermark"])
    assert.deepEqual(errorSchema.parse(body(name)), body(name), name);
  // The example of the mark decodes; the invented one does not.
  assert.deepEqual(decodeWatermark(watermarkExample), watermarkPosition);
  assert.equal(
    decodeWatermark(
      String(
        (cases.unknown_watermark.request as { body: { watermark: string } })
          .body.watermark,
      ),
    ),
    null,
  );
  // The mark of the examples is the newest notice of the targets file.
  const newest = targetsFile().cases[0].notification;
  assert.equal(newest.id, watermarkPosition.id);
  assert.equal(
    Date.parse(newest.createdAt),
    Date.parse(watermarkPosition.createdAt),
  );
});
