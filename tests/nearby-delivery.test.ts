import { after, test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  announcePlan,
  nearbyBox,
  planGeometry,
  runNotificationFanout,
} from "../lib/notification-fanout.ts";
import {
  nearbyNoticeStands,
  nearbyOffers,
  pruneNearbyAreas,
  removeNearbyArea,
  saveNearbyArea,
  saveNearbySettings,
  forgetNearby,
  skipNearbyDeliveries,
  snapToCell,
} from "../lib/nearby.ts";
import { createDeviceSession } from "../lib/device-sessions.ts";
import { toNearbyOffers } from "../lib/api-v1/mappers.ts";
import { notificationPage } from "../lib/notifications.ts";
import { saveNotificationSettings } from "../lib/notification-settings.ts";
import { notificationSettingsPatch } from "../lib/notification-settings.ts";
import { externalNoticeCheck } from "../lib/notification-external.ts";
import { processEnv } from "./support/env.ts";
import { testDatabase } from "./support/database.ts";
import { bikeRow } from "./support/bikes.ts";
import { userRow } from "./support/people.ts";
import { intentRow, invitationRow, planRow, rsvpRow } from "./support/rides.ts";

// The rides near a person (#343, N3.3): who is told about a new public plan
// because of the area they chose, once and for a reason, from what the plan
// says in public; who is not; and what stops when the area goes. Nothing here
// reads the place of a meeting, and no notice names a place or a distance.

const db = await testDatabase();
after(() => db.close());
const test = (name: string, body: () => Promise<void>) =>
  nodeTest(name, async () => {
    for (let round = 0; round < 20; round++)
      if (!(await runNotificationFanout(db, { pages: 10 })).claimed) break;
    await body();
  });
const hour = 3600_000;
const env = processEnv({ MAIL_CAPTURE_DIR: "/tmp/cola-nearby-delivery-test" });
const person = async () => (await userRow(db)).id;
const inFuture = (hours: number) => new Date(Date.now() + hours * hour);
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

// The centre of Moscow, as the grid keeps it, and a plan about a kilometre and
// a half away; "far" is another city.
const [homeLng, homeLat] = snapToCell(37.62, 55.75);
const aroundHome = {
  label: "Центр",
  center: [37.64, 55.76],
  radiusM: 3000,
};
const farAway = { label: "Тверь", center: [35.9, 56.86], radiusM: 3000 };
const kind = { purpose: "social", pace: "moderate", surface: "asphalt" };

async function author(passport: object = { area: aroundHome, ...kind }) {
  const id = await person();
  const bike = (await bikeRow(db, id)).id;
  const plan = (hours = 48, overrides = {}) =>
    planRow(db, id, bike, inFuture(hours), {
      plan_passport: passport,
      ...overrides,
    });
  return { id, bike, plan };
}

/**
 * Turns "rides near me" on with a hand-picked area, as the person would, and
 * says since when (the rule is: only what is published after).
 */
async function nearbyOn(
  id: string,
  {
    since = new Date(Date.now() - hour),
    radiusM = 10_000,
    horizonDays = 14,
    filters = {},
  }: {
    since?: Date;
    radiusM?: number;
    horizonDays?: number;
    filters?: object;
  } = {},
) {
  await saveNearbyArea(db, id, {
    source: "manual",
    center: [homeLng, homeLat],
    radiusM,
    label: "Центр",
  });
  await saveNearbySettings(db, id, { enabled: true, horizonDays, filters });
  await db.query("UPDATE nearby_areas SET updated_at=$2 WHERE user_id=$1", [
    id,
    since,
  ]);
}
const notices = async (id: string) =>
  (
    await db.query<{
      type: string;
      ride_id: string | null;
      reasons: string[];
      external: boolean;
      group_key: string | null;
    }>(
      "SELECT type,ride_id,reasons,external,group_key FROM notifications WHERE recipient_id=$1 AND type IN ('plan_published','plan_nearby') ORDER BY created_at,id",
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
const publish = async (a: Awaited<ReturnType<typeof author>>, hours = 48) => {
  const ride = await a.plan(hours);
  assert.equal(await announcePlan(db, ride.id), true);
  await drain();
  return ride;
};

test("a new public plan in the area reaches the person who turned the area on, once, as its own kind of notice", async () => {
  const a = await author();
  const reader = await person();
  const stranger = await person();
  await nearbyOn(reader);

  const ride = await publish(a);

  const got = await notices(reader);
  assert.equal(got.length, 1);
  assert.equal(got[0].type, "plan_nearby");
  assert.equal(got[0].ride_id, ride.id);
  assert.deepEqual(got[0].reasons, ["nearby"]);
  assert.equal((await notices(stranger)).length, 0, "no area, nothing is told");
  assert.equal((await notices(a.id)).length, 0, "not the author");
  const card = (await notificationPage(db, reader)).notifications[0];
  assert.equal(card.type, "plan_nearby");
  assert.equal(card.category, "nearby");
  assert.equal(card.target.type, "ride");
  assert.equal(card.target.id, ride.id);
  assert.deepEqual(card.reasons, ["nearby"]);
  assert.ok(card.target.occurrenceAt);
  // The same worker again, or the same plan announced again, says nothing twice.
  assert.equal(await announcePlan(db, ride.id), false);
  await drain();
  assert.equal((await notices(reader)).length, 1);
});

test("what is not in the area, not on, not in term or not wanted is not told", async () => {
  const a = await author();
  const off = await person();
  const noArea = await person();
  const expired = await person();
  const tooFar = await person();
  const horizon = await person();
  const wrongKind = await person();
  const rightKind = await person();
  const stale = await person();
  await nearbyOn(off);
  await saveNearbySettings(db, off, { enabled: false });
  await saveNearbySettings(db, noArea, { enabled: true });
  await nearbyOn(expired);
  await db.query(
    "UPDATE nearby_areas SET source='device',expires_at=now()-interval '1 hour' WHERE user_id=$1",
    [expired],
  );
  await nearbyOn(tooFar);
  await db.query(
    "UPDATE nearby_areas SET area_lng=35.4,area_lat=56.4,radius_m=5000 WHERE user_id=$1",
    [tooFar],
  );
  await nearbyOn(horizon, { horizonDays: 1 });
  await nearbyOn(wrongKind, { filters: { purposes: ["training"] } });
  await nearbyOn(rightKind, {
    filters: { purposes: ["social", "leisure"], paces: ["moderate"] },
  });
  // Turned on after the plan was published: the existing catalogue is not news.
  await nearbyOn(stale, { since: new Date(Date.now() + hour) });

  await publish(a, 72);

  for (const [name, id] of Object.entries({
    off,
    noArea,
    expired,
    tooFar,
    horizon,
    wrongKind,
    stale,
  }))
    assert.equal((await notices(id)).length, 0, name);
  assert.equal((await notices(rightKind)).length, 1, "the kind is wanted");
});

test("the edge of the circles: the areas overlap by their radii, and no more", async () => {
  // About 12.4 km between the centres: the person's 10 km and the plan's 3 km
  // overlap; with 5 km and 3 km they do not.
  const a = await author({
    area: { label: "Север", center: [homeLng, homeLat + 0.112], radiusM: 3000 },
    ...kind,
  });
  const wide = await person();
  const narrow = await person();
  await nearbyOn(wide, { radiusM: 10_000 });
  await nearbyOn(narrow, { radiusM: 5_000 });

  await publish(a);

  assert.equal((await notices(wide)).length, 1);
  assert.equal((await notices(narrow)).length, 0);
});

test("a plan that names no area is told to nobody near it, and a malformed one does not stop the walk", async () => {
  const none = await author({ ...kind });
  const broken = await author({
    area: { label: "?", center: ["x", 1], radiusM: "wide" },
    ...kind,
  });
  const reader = await person();
  await nearbyOn(reader);

  await publish(none);
  await publish(broken);

  assert.equal((await notices(reader)).length, 0);
  assert.equal(planGeometry({ area: { center: [1, 1] } }), null);
  assert.equal(planGeometry(null), null);
  const box = nearbyBox(
    {
      lat: 55.75,
      lng: 37.62,
      radiusM: 3000,
      purpose: null,
      pace: null,
      surface: null,
    },
    { nearbyMaxRadiusKm: 50 },
  );
  assert.ok(box.lat > 0.4 && box.lng > 0.7, "a box that holds 53 km");
});

test("a friend who is also near gets one notice, with both reasons and the time of their own intention", async () => {
  const a = await author();
  const both = await person();
  const onlyNear = await person();
  await friends(a.id, both);
  await nearbyOn(both);
  await nearbyOn(onlyNear);
  const start = inFuture(48);
  await intentRow(
    db,
    both,
    [[new Date(start.getTime() - hour), new Date(start.getTime() + 3 * hour)]],
    {
      status: "active",
    },
  );
  const ride = await a.plan(48, {
    started_at: start.toISOString(),
  });
  await announcePlan(db, ride.id);
  await drain();

  const mine = await notices(both);
  assert.equal(mine.length, 1, "one logical event");
  assert.equal(mine[0].type, "plan_published");
  assert.deepEqual(mine[0].reasons, ["friend", "nearby", "intent"]);
  const other = await notices(onlyNear);
  assert.equal(other.length, 1);
  assert.equal(other[0].type, "plan_nearby");
  assert.notEqual(
    other[0].group_key,
    mine[0].group_key,
    "the groups of the two kinds are apart",
  );
});

test("a friend who is not near gets the friends' notice with the reason friend", async () => {
  const a = await author({ area: farAway, ...kind });
  const friend = await person();
  await friends(a.id, friend);
  await nearbyOn(friend);

  await publish(a);

  const got = await notices(friend);
  assert.equal(got.length, 1);
  assert.equal(got[0].type, "plan_published");
  assert.deepEqual(got[0].reasons, ["friend"]);
  const card = (await notificationPage(db, friend)).notifications[0];
  assert.deepEqual(card.reasons, ["friend"]);
});

test("already invited, already answered, muted or blocked: the ride is not advertised", async () => {
  const a = await author();
  const invited = await person();
  const answered = await person();
  const muted = await person();
  const mutedRide = await person();
  const blocked = await person();
  for (const id of [invited, answered, muted, mutedRide, blocked])
    await nearbyOn(id);
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [blocked]);
  await settings(muted, { mutes: { add: [{ kind: "author", id: a.id }] } });
  const ride = await a.plan(60);
  await invitationRow(db, ride.id, invited);
  await rsvpRow(db, ride.id, answered, ride.started_at as Date);
  await settings(mutedRide, {
    mutes: { add: [{ kind: "ride", id: ride.id }] },
  });
  await announcePlan(db, ride.id);
  await drain();

  for (const [name, id] of Object.entries({
    invited,
    answered,
    muted,
    mutedRide,
    blocked,
  }))
    assert.equal((await notices(id)).length, 0, name);
});

test("a burst of one author's plans folds into one unread notice, and the budget of the outside is spent", async () => {
  const a = await author();
  const reader = await person();
  await nearbyOn(reader);

  const first = await publish(a, 50);
  const second = await publish(a, 70);

  const got = await notices(reader);
  assert.equal(got.length, 1, "the same author in the same quarter of an hour");
  assert.ok([first.id, second.id].includes(got[0].ride_id ?? ""));
  assert.equal(got[0].ride_id, second.id, "it points at the newest");
  assert.equal(got[0].external, true);
});

test("the operator's switches: nearby off, or its category off, tells nobody", async () => {
  const a = await author();
  const reader = await person();
  await nearbyOn(reader);
  await db.query(
    "UPDATE notification_limits SET nearby_enabled=false WHERE id=1",
  );
  try {
    await publish(a);
    assert.equal((await notices(reader)).length, 0);
  } finally {
    await db.query(
      "UPDATE notification_limits SET nearby_enabled=true WHERE id=1",
    );
  }
  const b = await author();
  await db.query(
    "UPDATE notification_limits SET disabled_categories=ARRAY['nearby'] WHERE id=1",
  );
  try {
    await publish(b);
    assert.equal((await notices(reader)).length, 0);
  } finally {
    await db.query(
      "UPDATE notification_limits SET disabled_categories='{}' WHERE id=1",
    );
  }
});

test("the meeting place is never read: a secret in it appears in no notice and no offer", async () => {
  const a = await author();
  const reader = await person();
  await nearbyOn(reader);
  const ride = await a.plan(48, {
    meeting_point: "Secret gate 7 / 55.7512,37.6184",
  });
  await announcePlan(db, ride.id);
  await drain();

  const page = JSON.stringify(await notificationPage(db, reader));
  assert.ok(!page.includes("Secret"), "not in the bell");
  assert.ok(!page.includes("55.7512"), "no coordinates");
  const found = await nearbyOffers(db, reader);
  assert.ok(found.rows.some((row) => row.id === ride.id));
  const offers = JSON.stringify(
    toNearbyOffers(found.state, found.rows, reader),
  );
  assert.ok(!offers.includes("Secret"), "not in the offers");
  assert.ok(!offers.includes("55.7512"));
  const stored = JSON.stringify(
    (
      await db.query("SELECT * FROM notifications WHERE recipient_id=$1", [
        reader,
      ])
    ).rows,
  );
  assert.ok(!stored.includes("Secret"), "not in the row");
});

test("turning it off hides the notices and stops what was waiting to be pushed", async () => {
  const a = await author();
  const reader = await person();
  await nearbyOn(reader);
  const ride = await publish(a);
  const notice = (
    await db.query<{ id: string }>(
      "SELECT id FROM notifications WHERE recipient_id=$1 AND type='plan_nearby'",
      [reader],
    )
  ).rows[0].id;
  const pushQueued = async (status: string) => {
    const session = (
      await createDeviceSession(
        db,
        reader,
        { name: "Pixel", platform: "android", appVersion: "1.0" },
        "test",
      )
    ).sessionId;
    await db.query(
      `INSERT INTO push_devices(session_id,user_id,installation_id,provider,project_id,token_ciphertext,token_hash)
       VALUES($1,$2,$3,'rustore','p','x',$4)`,
      [
        session,
        reader,
        randomUUID(),
        randomUUID().replaceAll("-", "").padEnd(64, "1"),
      ],
    );
    await db.query(
      `INSERT INTO push_deliveries(notification_id,recipient_id,device_session_id,generation,status,expires_at)
       VALUES($1,$2,$3,1,$4,now()+interval '1 day')`,
      [notice, reader, session, status],
    );
  };
  await pushQueued("pending");
  await pushQueued("sending");
  assert.equal((await notificationPage(db, reader)).notifications.length, 1);

  await saveNearbySettings(db, reader, { enabled: false });

  const states = (
    await db.query<{ status: string; error_code: string | null }>(
      "SELECT status,error_code FROM push_deliveries WHERE notification_id=$1 ORDER BY status",
      [notice],
    )
  ).rows;
  assert.deepEqual(states, [
    { status: "sending", error_code: null },
    { status: "skipped", error_code: "unavailable" },
  ]);
  assert.equal(
    (await notificationPage(db, reader)).notifications.length,
    0,
    "the bell does not show them while the area is off",
  );
  assert.equal(
    await nearbyNoticeStands(
      db,
      {
        recipientId: reader,
        rideId: ride.id,
        occursAt: ride.started_at as Date,
      },
      new Date(),
    ),
    false,
    "the sender, if it already holds one, stops at the check",
  );
});

test("removing, moving, expiring and forgetting the area each stop what was waiting", async () => {
  const reader = await person();
  const waiting = async () => {
    const a = await author();
    const ride = await publish(a);
    return ride;
  };
  const count = async () =>
    (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM push_deliveries WHERE recipient_id=$1 AND status='skipped'",
        [reader],
      )
    ).rows[0].n;
  void count;
  // The calls are safe to repeat and to make for a person with nothing waiting.
  await nearbyOn(reader);
  await waiting();
  assert.equal(await skipNearbyDeliveries(db, reader), 0);
  await removeNearbyArea(db, reader);
  await saveNearbyArea(db, reader, {
    source: "device",
    center: [homeLng, homeLat],
    radiusM: 5000,
  });
  assert.ok(await pruneNearbyAreas(db, new Date(Date.now() + 72 * hour)));
  assert.equal(
    (
      await db.query("SELECT area_lng FROM nearby_areas WHERE user_id=$1", [
        reader,
      ])
    ).rows[0].area_lng,
    null,
  );
  await forgetNearby(db, reader);
  assert.equal(
    (await db.query("SELECT 1 FROM nearby_areas WHERE user_id=$1", [reader]))
      .rowCount,
    0,
  );
});

test("at the moment of sending the area is read again: a plan that no longer lies in it is not sent", async () => {
  const a = await author();
  const reader = await person();
  await nearbyOn(reader);
  const ride = await publish(a);
  const notice = (await notices(reader))[0];
  const row = (
    await db.query<{ id: string; event_occurs_at: Date }>(
      "SELECT id,event_occurs_at FROM notifications WHERE recipient_id=$1 AND type='plan_nearby'",
      [reader],
    )
  ).rows[0];
  const subject = {
    notificationId: row.id,
    recipientId: reader,
    type: "plan_nearby",
    category: "nearby",
    rideId: ride.id,
    eventOccursAt: row.event_occurs_at,
    expiresAt: inFuture(24),
  };
  assert.equal(notice.type, "plan_nearby");
  const now = new Date();
  assert.ok("notice" in (await externalNoticeCheck(db, subject, "push", now)));

  // The person moves away, then comes back, then gets invited.
  await db.query(
    "UPDATE nearby_areas SET area_lng=35.4,area_lat=56.4 WHERE user_id=$1",
    [reader],
  );
  assert.deepEqual(await externalNoticeCheck(db, subject, "push", now), {
    code: "unavailable",
  });
  await db.query(
    "UPDATE nearby_areas SET area_lng=$2,area_lat=$3 WHERE user_id=$1",
    [reader, homeLng, homeLat],
  );
  assert.ok("notice" in (await externalNoticeCheck(db, subject, "push", now)));
  await invitationRow(db, ride.id, reader);
  assert.deepEqual(await externalNoticeCheck(db, subject, "push", now), {
    code: "unavailable",
  });
  await db.query("DELETE FROM ride_invitations WHERE user_id=$1", [reader]);
  // The ride becomes private.
  await db.query("UPDATE rides SET is_public=false WHERE id=$1", [ride.id]);
  assert.deepEqual(await externalNoticeCheck(db, subject, "push", now), {
    code: "unavailable",
  });
});

test("the current offers: what is on now in the area, on request, without news and without the person's own", async () => {
  // The offers are everything public in the area: start from an empty catalogue.
  await db.query("DELETE FROM rides");
  const a = await author();
  const farther = await author({ area: farAway, ...kind });
  const reader = await person();
  const own = await bikeRow(db, reader);
  await nearbyOn(reader, { since: new Date(Date.now() + hour) });
  const early = await a.plan(30);
  const later = await a.plan(90);
  await farther.plan(40);
  await planRow(db, reader, own.id, inFuture(35), {
    plan_passport: { area: aroundHome, ...kind },
  });
  const invited = await a.plan(50);
  await invitationRow(db, invited.id, reader);

  // Nothing was announced to this person (the area is newer than the plans), yet the offers show them.
  await drain();
  assert.equal((await notices(reader)).length, 0);
  const offers = await nearbyOffers(db, reader);

  assert.equal(offers.state, "ready");
  assert.deepEqual(
    offers.rows.map((row) => row.id),
    [early.id, later.id],
    "soonest first, near only, not the own, not the invited",
  );
  assert.equal(
    (await nearbyOffers(db, reader, { limit: 1 })).rows.length,
    1,
    "a short list",
  );
  assert.ok(
    !JSON.stringify(toNearbyOffers(offers.state, offers.rows, reader)).includes(
      "Secret",
    ),
    "the meeting place stays out",
  );
});

test("the offers say why they are empty", async () => {
  const reader = await person();
  assert.equal((await nearbyOffers(db, reader)).state, "off");
  await saveNearbySettings(db, reader, { enabled: true });
  assert.equal((await nearbyOffers(db, reader)).state, "no_area");
  await saveNearbyArea(db, reader, {
    source: "device",
    center: [homeLng, homeLat],
    radiusM: 5000,
  });
  assert.equal((await nearbyOffers(db, reader)).state, "ready");
  assert.equal(
    (await nearbyOffers(db, reader, { now: new Date(Date.now() + 48 * hour) }))
      .state,
    "expired",
  );
  await db.query(
    "UPDATE notification_limits SET nearby_enabled=false WHERE id=1",
  );
  try {
    assert.equal((await nearbyOffers(db, reader)).state, "unavailable");
  } finally {
    await db.query(
      "UPDATE notification_limits SET nearby_enabled=true WHERE id=1",
    );
  }
});

test("a plan that begins at the same time as the person's intention says so in the offers", async () => {
  await db.query("DELETE FROM rides");
  const a = await author();
  const reader = await person();
  await nearbyOn(reader);
  const start = inFuture(40);
  await intentRow(
    db,
    reader,
    [[new Date(start.getTime() - hour), new Date(start.getTime() + 2 * hour)]],
    { status: "active" },
  );
  const ride = await a.plan(40, { started_at: start.toISOString() });

  const offers = await nearbyOffers(db, reader);

  const found = offers.rows.find((row) => row.id === ride.id);
  assert.ok(found);
  assert.equal(found.intent_match, true);
});
