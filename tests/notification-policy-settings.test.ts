import test, { after } from "node:test";
import assert from "node:assert/strict";
import { ZodError } from "zod";
import {
  circleLimit,
  muteLimit,
  notificationSettings,
  notificationSettingsPatch,
  saveNotificationSettings,
} from "../lib/notification-settings.ts";
import { exportAccount } from "../lib/account-data.ts";
import { deliveryPolicy, noticeMutedSql } from "../lib/notification-policy.ts";
import { rideRow } from "./support/rides.ts";
import { bikeRow } from "./support/bikes.ts";
import { testDatabase } from "./support/database.ts";
import { processEnv } from "./support/env.ts";
import { bikeCommentRow, noticeRow } from "./support/notifications.ts";
import { userRow } from "./support/people.ts";
import { one } from "./support/rows.ts";

// The choices a person makes about when, from whom and about what they are told
// (#341): quiet hours on their own clock, a pause, the circle whose new plans
// reach them, and mutes. They live in the one settings model, change only what a
// request names, and never widen what a person may see.

const db = await testDatabase();
after(() => db.close());
const options = {
  env: processEnv({ MAIL_CAPTURE_DIR: "/tmp/cola-policy-test" }),
};
const person = async () => (await userRow(db)).id;
const patch = (value: unknown) => notificationSettingsPatch.parse(value);
const save = (id: string, value: unknown, extra = {}) =>
  saveNotificationSettings(db, id, patch(value), { ...options, ...extra });
const rejected = (work: Promise<unknown>, status: number, text?: RegExp) =>
  assert.rejects(
    work,
    (error: Error & { status?: number }) =>
      error.status === status && (!text || text.test(error.message)),
  );

test("defaults: no quiet hours, no pause, friends, nothing muted, 'considering' is not told", async () => {
  const settings = await notificationSettings(db, await person(), options);
  assert.equal(settings.timeZone, null);
  assert.deepEqual(settings.quietHours, {
    enabled: false,
    from: "22:00",
    to: "07:00",
    allowCancellations: false,
  });
  assert.equal(settings.pausedUntil, null);
  assert.deepEqual(settings.circle, { mode: "friends", members: [] });
  assert.equal(settings.considering, false);
  assert.deepEqual(settings.mutes, []);
});

test("quiet hours need a real IANA zone and a window that has a length", async () => {
  const id = await person();
  await rejected(
    save(id, { quietHours: { enabled: true } }),
    400,
    /часовой пояс/,
  );
  for (const wrong of ["+03:00", "Mars/Base", "GMT+3", ""])
    assert.throws(() => patch({ timeZone: wrong }), ZodError, wrong);
  for (const wrong of ["24:00", "7:00", "07:60", "late"])
    assert.throws(
      () => patch({ quietHours: { from: wrong } }),
      ZodError,
      wrong,
    );
  await rejected(
    save(id, {
      timeZone: "Europe/Moscow",
      quietHours: { enabled: true, from: "07:00", to: "07:00" },
    }),
    400,
    /в одно время/,
  );
  // Nothing of the refused changes stuck.
  const unchanged = await notificationSettings(db, id, options);
  assert.equal(unchanged.timeZone, null);
  assert.equal(unchanged.quietHours.enabled, false);

  const saved = await save(id, {
    timeZone: "Europe/Moscow",
    quietHours: { enabled: true, from: "23:00", to: "07:30" },
  });
  assert.equal(saved.timeZone, "Europe/Moscow");
  assert.deepEqual(saved.quietHours, {
    enabled: true,
    from: "23:00",
    to: "07:30",
    allowCancellations: false,
  });
  // What the policy reads is the same row.
  const policy = await deliveryPolicy(db, id);
  assert.equal(policy.timeZone, "Europe/Moscow");
  assert.deepEqual(policy.quiet, {
    enabled: true,
    from: 23 * 60,
    to: 7 * 60 + 30,
    allowCancellations: false,
  });
});

test("the zone cannot be taken away while the quiet hours are on, and a change names only what it changes", async () => {
  const id = await person();
  await save(id, { timeZone: "Europe/Berlin", quietHours: { enabled: true } });
  // The window keeps its times when only the switch changes.
  const off = await save(id, { quietHours: { enabled: false } });
  assert.equal(off.quietHours.from, "22:00");
  assert.equal(off.timeZone, "Europe/Berlin");
  const cancellations = await save(id, {
    quietHours: { allowCancellations: true },
  });
  assert.equal(cancellations.quietHours.allowCancellations, true);
  assert.equal(cancellations.quietHours.enabled, false);
  assert.equal(cancellations.reminders, true);
});

test("a pause lies in the near future, can be lifted, and an old one reads as no pause", async () => {
  const id = await person();
  const now = new Date("2026-10-04T12:00:00Z");
  await rejected(
    save(id, { pausedUntil: "2026-10-04T11:00:00.000Z" }, { now }),
    400,
    /пауза/i,
  );
  await rejected(
    save(id, { pausedUntil: "2028-10-04T11:00:00.000Z" }, { now }),
    400,
    /пауза/i,
  );
  const paused = await save(
    id,
    { pausedUntil: "2026-10-10T18:00:00.000Z" },
    { now },
  );
  assert.equal(paused.pausedUntil, "2026-10-10T18:00:00.000Z");
  assert.equal(
    (await deliveryPolicy(db, id)).pausedUntil?.toISOString(),
    "2026-10-10T18:00:00.000Z",
  );
  // After its end the pause is nothing, and nothing needs to be cleaned up.
  const later = await notificationSettings(db, id, {
    ...options,
    now: new Date("2026-10-11T00:00:00Z"),
  });
  assert.equal(later.pausedUntil, null);
  const lifted = await save(id, { pausedUntil: null }, { now });
  assert.equal(lifted.pausedUntil, null);
  // A client whose requests never carry null lifts the pause with `resume`.
  await save(id, { pausedUntil: "2026-10-10T18:00:00.000Z" }, { now });
  const resumed = await save(id, { resume: true }, { now });
  assert.equal(resumed.pausedUntil, null);
  assert.throws(
    () => patch({ resume: true, pausedUntil: "2026-10-10T18:00:00.000Z" }),
    ZodError,
  );
});

test("the circle: a mode, people picked by id, and nobody who cannot be named", async () => {
  const id = await person();
  const [anna, boris] = [await person(), await person()];
  const blocked = (await userRow(db, { blocked: true })).id;
  const saved = await save(id, {
    circle: { mode: "selected", add: [anna, boris] },
  });
  assert.equal(saved.circle.mode, "selected");
  assert.deepEqual(
    saved.circle.members.map((m) => m.id).sort(),
    [anna, boris].sort(),
  );
  assert.deepEqual(Object.keys(saved.circle.members[0]).sort(), [
    "avatar",
    "id",
    "name",
    "username",
  ]);
  // Repeating changes nothing, not even the version.
  const again = await save(id, { circle: { add: [anna] } });
  assert.equal(again.version, saved.version);
  // Removing a person and a person who was never there.
  const removed = await save(id, {
    circle: { remove: [anna, await person()] },
  });
  assert.deepEqual(
    removed.circle.members.map((m) => m.id),
    [boris],
  );
  assert.equal(removed.circle.mode, "selected");
  // Not oneself, not a blocked account, not someone who does not exist.
  await rejected(save(id, { circle: { add: [id] } }), 400);
  await rejected(save(id, { circle: { add: [blocked] } }), 400);
  await rejected(
    save(id, { circle: { add: ["00000000-0000-4000-8000-0000000000aa"] } }),
    400,
  );
  assert.throws(() => patch({ circle: { mode: "everyone" } }), ZodError);
  assert.throws(() => patch({ circle: { add: ["not-a-uuid"] } }), ZodError);
  // A blocked person leaves the circle without a trace on the page.
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [boris]);
  assert.deepEqual(
    (await notificationSettings(db, id, options)).circle.members,
    [],
  );
});

test("the circle has a limit and the list of a request is bounded", async () => {
  const id = await person();
  assert.throws(
    () =>
      patch({
        circle: {
          add: Array.from(
            { length: 51 },
            () => "00000000-0000-4000-8000-000000000001",
          ),
        },
      }),
    ZodError,
  );
  // Fill to the limit with people made at once.
  const rows = await db.query<{ id: string }>(
    `INSERT INTO users(id,email,password_hash,name,username)
    SELECT gen_random_uuid(),'circle'||g||'-'||gen_random_uuid()||'@example.test','x','Круг '||g,'circle'||g||'-'||substr(gen_random_uuid()::text,1,8) FROM generate_series(1,${circleLimit + 1}) g RETURNING id`,
  );
  const people = rows.rows.map((r) => r.id);
  await db.query(
    "INSERT INTO notification_circle_members(user_id,member_id) SELECT $1,unnest($2::uuid[])",
    [id, people.slice(0, circleLimit)],
  );
  await rejected(
    save(id, { circle: { add: [people[circleLimit]] } }),
    400,
    /не больше/,
  );
  // Taking one out in the same request makes room.
  const swapped = await save(id, {
    circle: { add: [people[circleLimit]], remove: [people[0]] },
  });
  assert.equal(swapped.circle.members.length, circleLimit);
});

test("mutes: an author, a ride and a discussion; the server does not say whether the target exists", async () => {
  const id = await person();
  const author = await person();
  const bike = (await bikeRow(db, author, { is_public: true })).id;
  const ride = (
    await rideRow(db, author, bike, { is_public: true, title: "Вечерний круг" })
  ).id;
  const hidden = (
    await rideRow(db, author, bike, { is_public: false, title: "Тайный выезд" })
  ).id;
  const unknown = "00000000-0000-4000-8000-0000000000bb";
  const saved = await save(id, {
    mutes: {
      add: [
        { kind: "author", id: author },
        { kind: "ride", id: ride },
        { kind: "ride", id: hidden },
        { kind: "discussion", id: bike },
        { kind: "ride", id: unknown },
      ],
    },
  });
  const label = (kind: string, target: string) =>
    saved.mutes.find((m) => m.kind === kind && m.id === target)?.label;
  assert.equal(saved.mutes.length, 5);
  assert.ok(label("author", author));
  assert.equal(label("ride", ride), "Вечерний круг");
  // What the person may not see has no name; nothing says it exists.
  assert.equal(label("ride", hidden), null);
  assert.equal(label("ride", unknown), null);
  assert.ok(label("discussion", bike));
  // Repeating and removing a mute that is not there change nothing.
  const same = await save(id, {
    mutes: {
      add: [{ kind: "author", id: author }],
      remove: [{ kind: "ride", id: author }],
    },
  });
  assert.equal(same.version, saved.version);
  const fewer = await save(id, {
    mutes: {
      remove: [
        { kind: "ride", id: ride },
        { kind: "ride", id: hidden },
      ],
    },
  });
  assert.equal(fewer.mutes.length, 3);
  await rejected(save(id, { mutes: { add: [{ kind: "author", id }] } }), 400);
  assert.throws(
    () => patch({ mutes: { add: [{ kind: "chat", id: ride }] } }),
    ZodError,
  );
  assert.equal(muteLimit, 500);
});

test("a mute silences what it names: its author, its ride, the comments under its object", async () => {
  const recipient = await person();
  const author = await person();
  const other = await person();
  const bike = (await bikeRow(db, recipient)).id;
  const ride = (await rideRow(db, recipient, bike)).id;
  const comment = (await bikeCommentRow(db, bike, other)).id;
  const muted = async (id: string) =>
    (
      await db.query<{ m: boolean }>(
        `SELECT ${noticeMutedSql("n")} m FROM notifications n WHERE n.id=$1`,
        [id],
      )
    ).rows[0].m;
  const byAuthor = await noticeRow(db, recipient, "follow", {
    actor_id: author,
  });
  const byOther = await noticeRow(db, recipient, "follow", { actor_id: other });
  const aboutRide = await noticeRow(db, recipient, "ride_like", {
    actor_id: other,
    ride_id: ride,
  });
  const aboutBike = await noticeRow(db, recipient, "comment", {
    actor_id: other,
    bike_id: bike,
    comment_id: comment,
  });
  assert.equal(await muted(byAuthor.id), false);
  await save(recipient, { mutes: { add: [{ kind: "author", id: author }] } });
  assert.equal(await muted(byAuthor.id), true);
  assert.equal(await muted(byOther.id), false);
  // A ride mute covers everything about the ride.
  await save(recipient, { mutes: { add: [{ kind: "ride", id: ride }] } });
  assert.equal(await muted(aboutRide.id), true);
  assert.equal(await muted(aboutBike.id), false);
  // A discussion mute covers the comments under the object, not a like of it.
  await save(recipient, {
    mutes: {
      remove: [{ kind: "ride", id: ride }],
      add: [
        { kind: "discussion", id: bike },
        { kind: "discussion", id: ride },
      ],
    },
  });
  assert.equal(await muted(aboutRide.id), false);
  assert.equal(await muted(aboutBike.id), true);
  // An author muted through someone else's list silences nothing here.
  const stranger = await noticeRow(db, other, "follow", { actor_id: author });
  assert.equal(await muted(stranger.id), false);
});

test("deleting an account removes its circle and mutes; the choices are one row and two small tables", async () => {
  const id = await person();
  const friend = await person();
  await save(id, {
    circle: { mode: "selected", add: [friend] },
    mutes: { add: [{ kind: "author", id: friend }] },
  });
  await db.query("DELETE FROM users WHERE id=$1", [friend]);
  const settings = await notificationSettings(db, id, options);
  assert.deepEqual(settings.circle.members, []);
  assert.equal(
    (
      await one<{ n: number }>(
        db,
        "SELECT count(*)::int n FROM notification_circle_members WHERE user_id=$1",
        [id],
      )
    ).n,
    0,
  );
  await db.query("DELETE FROM users WHERE id=$1", [id]);
  assert.equal(
    (
      await one<{ n: number }>(
        db,
        "SELECT count(*)::int n FROM notification_mutes WHERE user_id=$1",
        [id],
      )
    ).n,
    0,
  );
});

test("the export of an account holds the choices, with people by username and mutes by id", async () => {
  const id = await person();
  const friend = await userRow(db, { username: "export-friend" });
  const ride = (await rideRow(db, id, (await bikeRow(db, id)).id)).id;
  await save(id, {
    timeZone: "Europe/Berlin",
    quietHours: {
      enabled: true,
      from: "21:30",
      to: "06:45",
      allowCancellations: true,
    },
    pausedUntil: new Date(Date.now() + 86400_000).toISOString(),
    circle: { mode: "selected", add: [friend.id] },
    considering: true,
    mutes: { add: [{ kind: "ride", id: ride }] },
  });
  const exported = await exportAccount(db, id, "https://test.invalid");
  const settings = exported.notificationSettings;
  assert.equal(settings.timeZone, "Europe/Berlin");
  assert.deepEqual(settings.quietHours, {
    enabled: true,
    from: 1290,
    to: 405,
    allowCancellations: true,
  });
  assert.ok(settings.pausedUntil);
  assert.deepEqual(settings.circle, {
    mode: "selected",
    members: ["export-friend"],
  });
  assert.equal(settings.considering, true);
  assert.deepEqual(settings.mutes, [{ kind: "ride", id: ride }]);
});
