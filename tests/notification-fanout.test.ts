import { after, test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import {
  announceIntent,
  announcePlan,
  runNotificationFanout,
} from "../lib/notification-fanout.ts";
import { randomUUID } from "node:crypto";
import { createIntent, updateIntent } from "../lib/ride-intents.ts";
import {
  planInput,
  planRide,
  rideDefaults,
  rideEdit,
  saveRide,
} from "../lib/rides.ts";
import { notificationPage, readNotifications } from "../lib/notifications.ts";
import { saveNotificationSettings } from "../lib/notification-settings.ts";
import { notificationSettingsPatch } from "../lib/notification-settings.ts";
import { processEnv } from "./support/env.ts";
import { testDatabase } from "./support/database.ts";
import { bikeRow } from "./support/bikes.ts";
import { userRow } from "./support/people.ts";
import { intentDraft, intentRow, planRow } from "./support/rides.ts";

// What a person is told about the new plans and intents of the people around
// them (#341): the circle they chose, one notice per source, bounded pages that
// a second worker can finish, and a budget of what may leave the site. The
// notices are inbox records; nothing here sends.

const db = await testDatabase();
after(() => db.close());
// Every test starts with no announcement waiting, so that what it counts is its own.
const test = (name: string, body: () => Promise<void>) =>
  nodeTest(name, async () => {
    for (let round = 0; round < 20; round++)
      if (!(await runNotificationFanout(db, { pages: 10 })).claimed) break;
    await body();
  });
const hour = 3600_000;
const env = processEnv({ MAIL_CAPTURE_DIR: "/tmp/cola-fanout-test" });
const person = async () => (await userRow(db)).id;
const follow = (from: string, to: string) =>
  db.query(
    "INSERT INTO user_follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [from, to],
  );
const friends = async (a: string, b: string) => {
  await follow(a, b);
  await follow(b, a);
};
const settings = (id: string, patch: unknown) =>
  saveNotificationSettings(db, id, notificationSettingsPatch.parse(patch), {
    env,
  });
const inFuture = (hours: number) => new Date(Date.now() + hours * hour);
async function author() {
  const id = await person();
  const bike = (await bikeRow(db, id)).id;
  const plan = (hours = 48, overrides = {}) =>
    planRow(db, id, bike, inFuture(hours), overrides);
  return { id, bike, plan };
}
const notices = async (id: string) =>
  (
    await db.query<{
      id: string;
      type: string;
      ride_id: string | null;
      intent_id: string | null;
      read_at: Date | null;
      external: boolean;
      group_key: string | null;
    }>(
      "SELECT id,type,ride_id,intent_id,read_at,external,group_key FROM notifications WHERE recipient_id=$1 AND type IN ('plan_published','intent_published') ORDER BY created_at,id",
      [id],
    )
  ).rows;
const drain = async (now = new Date()) => {
  let total = 0;
  for (let round = 0; round < 20; round++) {
    const result = await runNotificationFanout(db, { now, pages: 10 });
    total += result.recipients;
    if (!result.claimed) break;
  }
  return total;
};

test("a new public plan reaches the friends of its author, and nobody else", async () => {
  const a = await author();
  const [friend, follower, followed, stranger, blocked, muted, selfless] =
    await Promise.all([
      person(),
      person(),
      person(),
      person(),
      person(),
      person(),
      person(),
    ]);
  await friends(a.id, friend);
  await follow(follower, a.id); // follows, is not followed back
  await follow(a.id, followed); // is followed, does not follow
  await friends(a.id, blocked);
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [blocked]);
  await friends(a.id, muted);
  await settings(muted, { mutes: { add: [{ kind: "author", id: a.id }] } });
  await friends(a.id, selfless);
  await settings(selfless, { circle: { mode: "off" } });

  const ride = await a.plan();
  assert.equal(await announcePlan(db, ride.id), true);
  await drain();

  const got = await notices(friend);
  assert.equal(got.length, 1);
  assert.equal(got[0].type, "plan_published");
  assert.equal(got[0].ride_id, ride.id);
  for (const none of [
    follower,
    followed,
    stranger,
    blocked,
    muted,
    selfless,
    a.id,
  ])
    assert.equal((await notices(none)).length, 0, none);
  // It shows on the page of the friend, with the target of a ride and its date.
  const card = (await notificationPage(db, friend)).notifications[0];
  assert.equal(card.type, "plan_published");
  assert.equal(card.target.type, "ride");
  assert.equal(card.target.id, ride.id);
  assert.equal(card.actor?.id, a.id);
  assert.ok(card.target.occurrenceAt);
});

test("the circle is the person's own: everyone they follow, the people they picked, or nobody", async () => {
  const a = await author();
  const [follower, picked, unpicked, off] = await Promise.all([
    person(),
    person(),
    person(),
    person(),
  ]);
  await follow(follower, a.id);
  await settings(follower, { circle: { mode: "follows" } });
  // Picked without any follow: the choice is enough to hear about this author.
  await settings(picked, { circle: { mode: "selected", add: [a.id] } });
  await settings(unpicked, {
    circle: { mode: "selected", add: [await person()] },
  });
  await follow(unpicked, a.id);
  await friends(a.id, off);
  await settings(off, { circle: { mode: "off" } });

  await announcePlan(db, (await a.plan()).id);
  await drain();
  assert.equal((await notices(follower)).length, 1);
  assert.equal((await notices(picked)).length, 1);
  assert.equal((await notices(unpicked)).length, 0);
  assert.equal((await notices(off)).length, 0);
});

test("a person who blocked the author, or whom the author blocked, is not told of their plan (#354)", async () => {
  const a = await author();
  const [friend, blockedByThem, blockedByAuthor] = await Promise.all([
    person(),
    person(),
    person(),
  ]);
  for (const other of [friend, blockedByThem, blockedByAuthor])
    await friends(a.id, other);
  // The rows alone, as the block of a person leaves them: the follows are
  // cut by `setBlock`, and the fan-out must hold even where they were not.
  await db.query(
    "INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2),($3,$4)",
    [blockedByThem, a.id, a.id, blockedByAuthor],
  );
  const ride = await a.plan();
  assert.equal(await announcePlan(db, ride.id), true);
  await drain();
  assert.equal((await notices(friend)).length, 1);
  assert.equal(
    (await notices(blockedByThem)).length,
    0,
    "who blocked the author",
  );
  assert.equal(
    (await notices(blockedByAuthor)).length,
    0,
    "whom the author blocked",
  );
});

test("a ride that is private, past, a completed one or the author's blocked is not announced", async () => {
  const a = await author();
  const friend = await person();
  await friends(a.id, friend);
  const privateRide = await a.plan(48, { is_public: false });
  assert.equal(await announcePlan(db, privateRide.id), false);
  const past = await a.plan(-5);
  assert.equal(await announcePlan(db, past.id), false);
  const done = await a.plan(48, { status: "completed", source_kind: "gpx" });
  assert.equal(await announcePlan(db, done.id), false);
  const hiddenBike = (await bikeRow(db, a.id, { is_public: false })).id;
  const onPrivateBike = await planRow(db, a.id, hiddenBike, inFuture(48));
  assert.equal(await announcePlan(db, onPrivateBike.id), false);
  assert.equal(await drain(), 0);
  assert.equal((await notices(friend)).length, 0);
});

test("private and public again, saving again and a second worker say nothing twice", async () => {
  const a = await author();
  const friend = await person();
  await friends(a.id, friend);
  const ride = await a.plan(48, { is_public: false });
  assert.equal(await announcePlan(db, ride.id), false);

  await db.query("UPDATE rides SET is_public=true WHERE id=$1", [ride.id]);
  assert.equal(await announcePlan(db, ride.id), true);
  assert.equal(await announcePlan(db, ride.id), false);
  assert.equal(await drain(), 1);

  await db.query("UPDATE rides SET is_public=false WHERE id=$1", [ride.id]);
  await announcePlan(db, ride.id);
  await db.query("UPDATE rides SET is_public=true WHERE id=$1", [ride.id]);
  assert.equal(await announcePlan(db, ride.id), false);
  assert.equal(await drain(), 0);
  // Two workers asked for the same work: nothing is made twice.
  const [x, y] = await Promise.all([
    runNotificationFanout(db),
    runNotificationFanout(db),
  ]);
  assert.equal(x.recipients + y.recipients, 0);
  assert.equal((await notices(friend)).length, 1);
});

test("a source that stopped being published before anyone was told is forgotten, so its real publication is announced", async () => {
  const a = await author();
  const friend = await person();
  await friends(a.id, friend);
  const ride = await a.plan();
  assert.equal(await announcePlan(db, ride.id), true);
  // Made private before the worker came.
  await db.query("UPDATE rides SET is_public=false WHERE id=$1", [ride.id]);
  const result = await runNotificationFanout(db);
  assert.equal(result.cancelled, 1);
  assert.equal((await notices(friend)).length, 0);
  assert.equal(
    (
      await db.query("SELECT 1 FROM notification_fanouts WHERE source_id=$1", [
        ride.id,
      ])
    ).rowCount,
    0,
  );
  await db.query("UPDATE rides SET is_public=true WHERE id=$1", [ride.id]);
  assert.equal(await announcePlan(db, ride.id), true);
  assert.equal(await drain(), 1);
});

test("a private intent is told to no one, a community one to the circle, and 'considering' only to those who asked", async () => {
  const a = await person();
  const [friend, curious] = await Promise.all([person(), person()]);
  await friends(a, friend);
  await friends(a, curious);
  await settings(curious, { considering: true });
  const window = [[inFuture(24), inFuture(26)]] as const;

  const secret = await intentRow(db, a, window, { visibility: "private" });
  assert.equal(await announceIntent(db, secret.id), false);

  const maybe = await intentRow(db, a, window, { readiness: "considering" });
  assert.equal(await announceIntent(db, maybe.id), true);
  await drain();
  assert.equal((await notices(friend)).length, 0);
  const got = await notices(curious);
  assert.equal(got.length, 1);
  assert.equal(got[0].type, "intent_published");
  assert.equal(got[0].intent_id, maybe.id);

  const ready = await intentRow(db, a, window);
  assert.equal(await announceIntent(db, ready.id), true);
  await drain();
  assert.equal((await notices(friend)).length, 1);
  const card = (await notificationPage(db, friend)).notifications[0];
  assert.equal(card.type, "intent_published");
  assert.equal(card.target.type, "intent");
  assert.equal(card.target.id, ready.id);
});

test("an intent goes from 'considering' to 'ready' and back: each is said once", async () => {
  const a = await person();
  const friend = await person();
  await friends(a, friend);
  await settings(friend, { considering: true });
  const intent = await intentRow(db, a, [[inFuture(24), inFuture(26)]], {
    readiness: "considering",
  });
  assert.equal(await announceIntent(db, intent.id), true);
  await db.query("UPDATE ride_intents SET readiness='ready' WHERE id=$1", [
    intent.id,
  ]);
  assert.equal(await announceIntent(db, intent.id), true);
  await db.query(
    "UPDATE ride_intents SET readiness='considering' WHERE id=$1",
    [intent.id],
  );
  assert.equal(await announceIntent(db, intent.id), false);
  await db.query("UPDATE ride_intents SET readiness='ready' WHERE id=$1", [
    intent.id,
  ]);
  assert.equal(await announceIntent(db, intent.id), false);
});

test("an intent that is not public, active and still to come is not announced; a closed one stops", async () => {
  const a = await person();
  const friend = await person();
  await friends(a, friend);
  const expired = await intentRow(db, a, [[inFuture(-5), inFuture(-3)]]);
  assert.equal(await announceIntent(db, expired.id), false);
  const cancelled = await intentRow(db, a, [[inFuture(24), inFuture(26)]], {
    status: "cancelled",
  });
  assert.equal(await announceIntent(db, cancelled.id), false);
  const live = await intentRow(db, a, [[inFuture(24), inFuture(26)]]);
  assert.equal(await announceIntent(db, live.id), true);
  await db.query("UPDATE ride_intents SET visibility='private' WHERE id=$1", [
    live.id,
  ]);
  assert.equal(await drain(), 0);
  assert.equal((await notices(friend)).length, 0);
});

test("a long audience is walked in pages, a dead worker is replaced, nobody is told twice", async () => {
  const a = await author();
  const audience = await Promise.all(Array.from({ length: 5 }, person));
  for (const id of audience) await friends(a.id, id);
  await db.query("UPDATE notification_limits SET batch=2");
  try {
    const ride = await a.plan();
    await announcePlan(db, ride.id);
    const first = await runNotificationFanout(db, { pages: 1 });
    assert.equal(first.recipients, 2);
    // The worker died holding the lease: nobody can take the work until it runs out.
    await db.query(
      "UPDATE notification_fanouts SET lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' WHERE source_id=$1",
      [ride.id],
    );
    assert.equal((await runNotificationFanout(db, { pages: 1 })).claimed, 0);
    // The lease ran out; the next worker continues from the last recipient.
    await db.query(
      "UPDATE notification_fanouts SET lease_until=now()-interval '1 second' WHERE source_id=$1",
      [ride.id],
    );
    assert.equal(await drain(), 3);
    const told = await Promise.all(
      audience.map(async (id) => (await notices(id)).length),
    );
    assert.deepEqual(told, [1, 1, 1, 1, 1]);
    const job = (
      await db.query<{ status: string; handled: number }>(
        "SELECT status,handled FROM notification_fanouts WHERE source_id=$1",
        [ride.id],
      )
    ).rows[0];
    assert.deepEqual(job, { status: "done", handled: 5 });
    // The same work again changes nothing.
    assert.equal(await drain(), 0);
  } finally {
    await db.query("UPDATE notification_limits SET batch=200");
  }
});

test("the audience of one announcement is bounded", async () => {
  const a = await author();
  const audience = await Promise.all(Array.from({ length: 4 }, person));
  for (const id of audience) await friends(a.id, id);
  await db.query("UPDATE notification_limits SET audience_max=3,batch=2");
  try {
    await announcePlan(db, (await a.plan()).id);
    assert.equal(await drain(), 3);
  } finally {
    await db.query(
      "UPDATE notification_limits SET audience_max=5000,batch=200",
    );
  }
});

test("a burst from one author is one unread notice that points at the newest; after it was read the next one is new", async () => {
  const a = await author();
  const friend = await person();
  await friends(a.id, friend);
  const now = new Date();
  const first = await a.plan(48);
  const second = await a.plan(72);
  const third = await a.plan(96);
  // Announced in turn, a moment apart: the worker takes them in that order.
  for (const [index, ride] of [first, second, third].entries())
    await announcePlan(db, ride.id, new Date(now.getTime() + index));
  await drain(now);
  const burst = await notices(friend);
  assert.equal(burst.length, 1);
  assert.equal(burst[0].ride_id, third.id);

  await readNotifications(db, friend, burst[0].id);
  const fourth = await a.plan(120);
  const later = new Date(now.getTime() + 60_000);
  await announcePlan(db, fourth.id, later);
  await drain(later);
  const after = await notices(friend);
  assert.equal(after.length, 2);
  assert.equal(after[1].ride_id, fourth.id);
  assert.ok(after[0].read_at);
  assert.equal(after[1].read_at, null);
});

test("what may leave the site is a budget: a few a day, and not twice from one author in a row", async () => {
  const friend = await person();
  const start = new Date("2026-10-04T08:00:00Z");
  // The moment of the plans is now (they must lie in the future of the clock used).
  const authors = await Promise.all(Array.from({ length: 5 }, author));
  for (const a of authors) await friends(a.id, friend);
  // Five different authors in a few hours: the first three may leave, the rest stay on the site.
  let index = 0;
  for (const a of authors) {
    const at = new Date(start.getTime() + index++ * hour);
    const ride = await planRow(
      db,
      a.id,
      a.bike,
      new Date(at.getTime() + 48 * hour),
    );
    await announcePlan(db, ride.id, at);
    await drain(at);
  }
  const day = await notices(friend);
  assert.equal(day.length, 5, "the inbox has everything");
  assert.deepEqual(
    day.map((n) => n.external),
    [true, true, true, false, false],
  );

  // A day later the budget is whole again.
  const next = new Date(start.getTime() + 25 * hour);
  const late = await planRow(
    db,
    authors[0].id,
    authors[0].bike,
    new Date(next.getTime() + 48 * hour),
  );
  await announcePlan(db, late.id, next);
  await drain(next);
  const all = await notices(friend);
  assert.equal(all.length, 6);
  // ... but not from an author who spoke within the cooldown (here: 6 hours; this one, 25).
  assert.equal(all[5].external, true);
});

test("the cooldown of an author holds even when the budget of the day is whole", async () => {
  const a = await author();
  const friend = await person();
  await friends(a.id, friend);
  const start = new Date("2026-10-04T08:00:00Z");
  const first = await planRow(
    db,
    a.id,
    a.bike,
    new Date(start.getTime() + 48 * hour),
  );
  await announcePlan(db, first.id, start);
  await drain(start);
  const [one] = await notices(friend);
  await readNotifications(db, friend, one.id);
  // An hour later, with the first one read: a new notice, but it stays on the site.
  const later = new Date(start.getTime() + hour);
  const second = await planRow(
    db,
    a.id,
    a.bike,
    new Date(later.getTime() + 48 * hour),
  );
  await announcePlan(db, second.id, later);
  await drain(later);
  const both = await notices(friend);
  assert.equal(both.length, 2);
  assert.deepEqual(
    both.map((n) => n.external),
    [true, false],
  );
});

test("an author cannot announce without end, and the kill switch stops everything", async () => {
  const a = await author();
  await db.query(
    "UPDATE notification_limits SET announcements_per_author_day=2",
  );
  try {
    const made = [];
    for (let index = 0; index < 4; index++)
      made.push(await announcePlan(db, (await a.plan(48 + index)).id));
    assert.deepEqual(made, [true, true, false, false]);
  } finally {
    await db.query(
      "UPDATE notification_limits SET announcements_per_author_day=10",
    );
  }
  await db.query("UPDATE notification_limits SET discovery_enabled=false");
  try {
    const b = await author();
    assert.equal(await announcePlan(db, (await b.plan()).id), false);
  } finally {
    await db.query("UPDATE notification_limits SET discovery_enabled=true");
  }
});

test("the inbox shows a discovery notice while it is true: gone with the ride's publicity, its date and its author's standing", async () => {
  const a = await author();
  const friend = await person();
  await friends(a.id, friend);
  const ride = await a.plan();
  await announcePlan(db, ride.id);
  await drain();
  const visible = async () =>
    (await notificationPage(db, friend)).notifications.length;
  assert.equal(await visible(), 1);
  await db.query("UPDATE rides SET is_public=false WHERE id=$1", [ride.id]);
  assert.equal(await visible(), 0);
  await db.query("UPDATE rides SET is_public=true WHERE id=$1", [ride.id]);
  assert.equal(await visible(), 1);
  await db.query(
    "UPDATE rides SET started_at=now()-interval '1 day' WHERE id=$1",
    [ride.id],
  );
  assert.equal(await visible(), 0);
  await db.query(
    "UPDATE rides SET started_at=now()+interval '2 days' WHERE id=$1",
    [ride.id],
  );
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [a.id]);
  assert.equal(await visible(), 0);
});

test("unfollowing before the worker comes, or never having followed, is read at the moment of the walk; a person reached by two reasons is told once", async () => {
  const a = await author();
  const [gone, both, kept] = await Promise.all([person(), person(), person()]);
  await friends(a.id, gone);
  await friends(a.id, kept);
  // "selected" and also a follower: two reasons to be in the audience, one notice.
  await follow(both, a.id);
  await settings(both, { circle: { mode: "selected", add: [a.id] } });
  const ride = await a.plan();
  assert.equal(await announcePlan(db, ride.id), true);
  // Between the announcement and the worker one of the friends unfollows.
  await db.query(
    "DELETE FROM user_follows WHERE follower_id=$1 AND following_id=$2",
    [gone, a.id],
  );
  await drain();
  assert.equal((await notices(gone)).length, 0);
  assert.equal((await notices(both)).length, 1);
  assert.equal((await notices(kept)).length, 1);
  // What was said stays in the inbox of the one who unfollowed afterwards.
  await db.query(
    "DELETE FROM user_follows WHERE follower_id=$1 AND following_id=$2",
    [kept, a.id],
  );
  assert.equal((await notificationPage(db, kept)).notifications.length, 1);
});

test("the domain writers announce: a public plan and a community intent once, a private one when it is made public", async () => {
  const a = await author();
  const friend = await person();
  await friends(a.id, friend);
  const announcements = async () =>
    (
      await db.query<{ kind: string; considering: boolean }>(
        "SELECT kind,considering FROM notification_fanouts WHERE author_id=$1 ORDER BY created_at,id",
        [a.id],
      )
    ).rows;
  const plan = (isPublic: boolean) =>
    db.transaction((q) =>
      planRide(
        q,
        a.id,
        planInput.parse({
          bikeId: a.bike,
          title: "Domain plan",
          scheduledAt: inFuture(48).toISOString(),
          isPublic,
          privacyEnabled: true,
          privacyRadiusM: 500,
          passport: {
            area: { label: "Москва" },
            purpose: "social",
            pace: "relaxed",
          },
        }),
        rideDefaults,
      ),
    );
  // Private: nothing. Then edited into a public plan: said, and only once.
  const hidden = await plan(false);
  assert.deepEqual(await announcements(), []);
  const edit = (isPublic: boolean) =>
    db.transaction((q) =>
      saveRide(
        q,
        a.id,
        rideEdit.parse({
          bikeId: a.bike,
          title: "Domain plan",
          description: "",
          isPublic,
          privacyEnabled: true,
          privacyRadiusM: 500,
        }),
        rideDefaults,
        hidden.id,
      ),
    );
  await edit(true);
  assert.deepEqual(await announcements(), [
    { kind: "plan_published", considering: false },
  ]);
  await edit(false);
  await edit(true);
  assert.equal((await announcements()).length, 1);
  // A public plan is announced as it is made.
  await plan(true);
  assert.equal((await announcements()).length, 2);

  // An intent: private is not, community is, and a retry is not said again.
  const draft = (visibility: "private" | "community") => ({
    ...intentDraft({ readiness: "ready", visibility }),
    requestId: randomUUID(),
  });
  await db.transaction((q) => createIntent(q, a.id, draft("private")));
  assert.equal((await announcements()).length, 2);
  const input = draft("community");
  const made = await db.transaction((q) => createIntent(q, a.id, input));
  assert.equal((await announcements()).length, 3);
  await db.transaction((q) => createIntent(q, a.id, input));
  assert.equal((await announcements()).length, 3);
  // Private made community by an edit: said then.
  const privateOne = await db.transaction((q) =>
    createIntent(q, a.id, draft("private")),
  );
  const { requestId, ...editable } = draft("community");
  assert.ok(requestId);
  await db.transaction((q) =>
    updateIntent(q, a.id, privateOne.intent.id, editable),
  );
  assert.equal((await announcements()).length, 4);
  assert.ok(made.created);
  await drain();
  // Four announcements within a quarter of an hour: one notice for the plans
  // and one for the intents, each pointing at the newest.
  assert.deepEqual((await notices(friend)).map((n) => n.type).sort(), [
    "intent_published",
    "plan_published",
  ]);
});
