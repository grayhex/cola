import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  apiRideRow,
  apiRideVisible,
  rideKeysetPage,
  upcomingKeysetPage,
} from "../lib/rides.ts";
import { insertBike } from "../lib/repository.ts";
import { bikeInput } from "../lib/validation.ts";
import { publicGeometry } from "../lib/ride-geometry.ts";
import { toRide, toRideSummary } from "../lib/api-v1/mappers.ts";
import { decodeCursor, encodeCursor } from "../lib/api-v1/cursor.ts";
import { rideSchema, rideSummarySchema } from "../lib/api-v1/schemas.ts";
import { loop } from "./ride-fixtures.js";

// API v1, rides (#302): who sees which ride, what a card may carry, the order
// of both lists and the meeting point. The HTTP layer end to end, with real
// uploaded tracks, is tests/api-v1-rides-http.js.

const root = fileURLToPath(new URL("../", import.meta.url));
const db = new PGlite();
for (const file of (await readdir(path.join(root, "db")))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(path.join(root, "db", file), "utf8"));
after(() => db.close());

async function addUser(label, { blocked = false } = {}) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,username,blocked) VALUES($1,$2,$3,'hash',$4,$5)",
    [
      id,
      id + "@test.invalid",
      "Имя " + label,
      (label + "-" + id.slice(0, 8)).toLowerCase(),
      blocked,
    ],
  );
  return id;
}
async function addBike(owner, isPublic = true) {
  return insertBike(
    db,
    owner,
    bikeInput.parse({
      name: "Bike " + randomUUID().slice(0, 6),
      brand: "Cube",
      model: "Nuroad",
      year: 2024,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: null,
      is_public: isPublic,
    }),
  );
}
const hours = (n) => new Date(Date.now() + n * 3600000).toISOString();
async function addRide(owner, bike, options = {}) {
  const {
    title = "Ride " + randomUUID().slice(0, 6),
    status = "completed",
    isPublic = true,
    startedAt = hours(-48),
    createdAt = null,
    geometry = [],
    recurrence = "none",
    meeting = "",
    visibility = "public",
    passport = {},
    metrics = {},
    visible = null,
  } = options;
  const id = randomUUID();
  const planned = status !== "completed";
  await db.query(
    `INSERT INTO rides(id,share_id,owner_id,bike_id,title,description,status,source_kind,has_track,is_public,started_at,created_at,distance_m,point_count,public_point_count,public_geometry,privacy_enabled,privacy_radius_m,source_hash,recurrence,meeting_point,meeting_visibility,plan_passport,import_metrics,visible_metrics)
     VALUES($1,$1,$2,$3,$4,'описание',$5,$6,$7,$8,$9,coalesce($10::timestamptz,now()),$11,2,2,$12,true,500,$13,$14,$15,$16,$17,$18,$19)`,
    [
      id,
      owner,
      bike,
      title,
      status,
      planned ? "planned" : "gpx",
      !planned && geometry.length > 0,
      isPublic,
      startedAt,
      createdAt,
      planned ? 0 : 12000,
      JSON.stringify(geometry),
      "fixture-" + id,
      recurrence,
      meeting,
      visibility,
      JSON.stringify(passport),
      JSON.stringify(metrics),
      visible ? JSON.stringify(visible) : null,
    ],
  );
  return id;
}
const page = (options = {}) =>
  rideKeysetPage(db, options.viewer ?? null, {
    bikeId: options.bikeId ?? null,
    limit: options.limit ?? 50,
    after: options.after ?? null,
  });
const ids = (result) => result.rows.map((row) => row.id);

const owner = await addUser("owner");
const stranger = await addUser("stranger");
const blockedAuthor = await addUser("blocked", { blocked: true });
const publicBike = await addBike(owner);
const privateBike = await addBike(owner, false);
const blockedBike = await addBike(blockedAuthor);

test("visibility: only public, not called off, of a public bike by a person who is not blocked", async () => {
  const shown = await addRide(owner, publicBike, { title: "Показана" });
  const hidden = {
    private: await addRide(owner, publicBike, { isPublic: false }),
    privateBike: await addRide(owner, privateBike),
    blocked: await addRide(blockedAuthor, blockedBike),
    cancelledPlan: await addRide(owner, publicBike, {
      status: "cancelled",
      startedAt: hours(72),
    }),
  };
  for (const viewer of [null, stranger, owner]) {
    const seen = ids(await page({ viewer }));
    assert.ok(seen.includes(shown));
    for (const id of Object.values(hidden)) {
      assert.ok(!seen.includes(id));
      // Not even the owner reads their own hidden ride here: that is the
      // personal view of a later slice.
      assert.equal(await apiRideRow(db, id, viewer), undefined);
      assert.equal(await apiRideVisible(db, id), false);
    }
    assert.ok(await apiRideRow(db, shown, viewer));
  }
  assert.equal(await apiRideVisible(db, shown), true);
  assert.equal(await apiRideRow(db, randomUUID(), null), undefined);
  // Blocking the author after the fact hides what was public.
  const later = await addUser("later");
  const laterRide = await addRide(later, await addBike(later));
  assert.ok(await apiRideRow(db, laterRide, null));
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [later]);
  assert.equal(await apiRideRow(db, laterRide, null), undefined);
  assert.ok(!ids(await page()).includes(laterRide));
});

test("the finished list holds finished rides only, optionally of one bike", async () => {
  const user = await addUser("lister");
  const bikeA = await addBike(user);
  const bikeB = await addBike(user);
  const a = await addRide(user, bikeA);
  const b = await addRide(user, bikeB);
  const plan = await addRide(user, bikeA, {
    status: "planned",
    startedAt: hours(50),
  });
  const all = ids(await page());
  assert.ok(all.includes(a) && all.includes(b) && !all.includes(plan));
  assert.deepEqual(ids(await page({ bikeId: bikeA })), [a]);
  assert.deepEqual(ids(await page({ bikeId: bikeB })), [b]);
});

test("finished list: newest first, keyset paging without repeats across equal and microsecond-close starts, a track without time, and a ride added meanwhile", async () => {
  const user = await addUser("pager");
  const bike = await addBike(user);
  const same = "2026-08-10T10:00:00.500000Z";
  const made = [];
  for (let i = 0; i < 4; i++)
    made.push(await addRide(user, bike, { startedAt: same }));
  made.push(
    await addRide(user, bike, { startedAt: "2026-08-10T10:00:00.500001Z" }),
  );
  made.push(await addRide(user, bike, { startedAt: "2026-08-01T00:00:00Z" }));
  // No start time: it stands where it was added.
  await db.query("UPDATE rides SET started_at=NULL WHERE id=$1", [made[5]]);
  await db.query("UPDATE rides SET created_at=$2 WHERE id=$1", [
    made[5],
    "2026-08-05T00:00:00Z",
  ]);

  const seen = [];
  let after = null;
  let fresh = null;
  for (let step = 0; step < 10; step++) {
    const result = await page({ bikeId: bike, limit: 2, after });
    assert.ok(result.rows.length <= 2);
    seen.push(...ids(result));
    if (step === 0)
      // A ride added between pages lands before the cursor and shifts nothing.
      fresh = await addRide(user, bike, { startedAt: hours(-1) });
    if (!result.next) break;
    after = decodeCursor(encodeCursor(result.next));
  }
  assert.equal(new Set(seen).size, seen.length, "no repeats");
  assert.ok(!seen.includes(fresh));
  assert.equal(seen.length, 6);
  assert.equal(seen[0], made[4], "the microsecond later start is first");
  assert.deepEqual(
    seen.slice(1, 5),
    made.slice(0, 4).sort().reverse(),
    "equal starts by id, descending",
  );
  assert.equal(seen[5], made[5], "the dateless track by its added date");
  assert.ok(
    (await page({ bikeId: bike })).rows.map((r) => r.id).includes(fresh),
    "and the new ride is there from the first page of a fresh listing",
  );
});

test("upcoming: soonest first, a weekly series once at its next date, past and called-off dates skipped", async () => {
  const user = await addUser("planner");
  const bike = await addBike(user);
  const soon = await addRide(user, bike, {
    status: "planned",
    startedAt: hours(30),
  });
  const later = await addRide(user, bike, {
    status: "planned",
    startedAt: hours(200),
  });
  const past = await addRide(user, bike, {
    status: "planned",
    startedAt: hours(-5),
  });
  const weekly = await addRide(user, bike, {
    status: "planned",
    startedAt: hours(-24 * 20),
    recurrence: "weekly",
  });
  const hiddenPlan = await addRide(user, bike, {
    status: "planned",
    startedAt: hours(40),
    isPublic: false,
  });
  const recurring = await upcomingKeysetPage(db, null, {
    limit: 50,
    after: null,
  });
  const order = ids(recurring);
  assert.ok(order.includes(weekly), "a weekly series stays in the list");
  assert.ok(!order.includes(past) && !order.includes(hiddenPlan));
  const mine = order.filter((id) => [soon, later, weekly].includes(id));
  const dates = (id) =>
    recurring.rows.find((row) => row.id === id).occurs_at.getTime();
  assert.deepEqual(
    mine,
    [soon, later, weekly].sort((a, b) => dates(a) - dates(b)),
  );
  // The series date is in the next week, in the future.
  assert.ok(dates(weekly) > Date.now());
  assert.ok(dates(weekly) < Date.now() + 7 * 24 * 3600000 + 1000);

  // Calling off the next date of a series skips to the week after it.
  const next = new Date(dates(weekly));
  await db.query(
    "INSERT INTO ride_cancelled_occurrences(ride_id,occurs_on,occurs_at) VALUES($1,($2::timestamptz AT TIME ZONE 'Europe/Moscow')::date,$2)",
    [weekly, next.toISOString()],
  );
  const skipped = await upcomingKeysetPage(db, null, {
    limit: 50,
    after: null,
  });
  const moved = skipped.rows.find((row) => row.id === weekly).occurs_at;
  assert.equal(moved.getTime() - next.getTime(), 7 * 24 * 3600000);

  // Paging one by one visits every item once, in order.
  const walked = [];
  let after = null;
  for (let step = 0; step < 50; step++) {
    const result = await upcomingKeysetPage(db, null, { limit: 1, after });
    walked.push(...ids(result));
    if (!result.next) break;
    after = decodeCursor(encodeCursor(result.next));
  }
  assert.deepEqual(walked, ids(skipped));
  assert.equal(new Set(walked).size, walked.length);
});

test("meeting point: the organizer and people who said going; everyone else is told it is hidden", async () => {
  const organizer = await addUser("org");
  const accepted = await addUser("going");
  const maybe = await addUser("maybe");
  const invited = await addUser("invited");
  const other = await addUser("other");
  const bike = await addBike(organizer);
  const startedAt = hours(60);
  const secret = "У фонтана, секрет";
  const hiddenRide = await addRide(organizer, bike, {
    status: "planned",
    startedAt,
    meeting: secret,
    visibility: "participants",
  });
  const openRide = await addRide(organizer, bike, {
    status: "planned",
    startedAt,
    meeting: "Открытая точка",
  });
  for (const [user, response] of [
    [accepted, "accepted"],
    [maybe, "maybe"],
  ])
    await db.query(
      "INSERT INTO ride_rsvps(ride_id,user_id,occurs_at,response) VALUES($1,$2,$3,$4)",
      [hiddenRide, user, startedAt, response],
    );
  await db.query(
    "INSERT INTO ride_invitations(ride_id,user_id) VALUES($1,$2)",
    [hiddenRide, invited],
  );
  const card = async (id, viewer) =>
    toRide(await apiRideRow(db, id, viewer), viewer);

  for (const [viewer, sees] of [
    [organizer, true],
    [accepted, true],
    [maybe, false],
    [invited, false],
    [other, false],
    [null, false],
  ]) {
    const ride = await card(hiddenRide, viewer);
    assert.equal(ride.meetingPoint, sees ? secret : null, String(viewer));
    assert.equal(ride.meetingHidden, !sees);
    assert.ok(
      sees || !JSON.stringify(ride).includes("фонтан"),
      "the text is nowhere in a response",
    );
    // Also in the list: a summary has no meeting point at all.
    assert.ok(
      !(
        "meetingPoint" in
        toRideSummary(await apiRideRow(db, hiddenRide, viewer), viewer)
      ),
    );
    const open = await card(openRide, viewer);
    assert.equal(open.meetingPoint, "Открытая точка");
    assert.equal(open.meetingHidden, false);
  }
  // Counters carry numbers, never names.
  const counted = await card(hiddenRide, null);
  assert.deepEqual(counted.participants, { going: 1, maybe: 1 });
  for (const person of [accepted, maybe, invited, other])
    assert.ok(!JSON.stringify(counted).includes(person));
  // A blocked person's answer is not counted.
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [maybe]);
  assert.deepEqual((await card(hiddenRide, null)).participants, {
    going: 1,
    maybe: 0,
  });
});

const forbidden = [
  "privacyEnabled",
  "privacyRadiusM",
  "pointCount",
  "publicPointCount",
  "isPublic",
  "isOwner",
  "shareId",
  "ownerId",
  "owner_series",
  "invitations",
  "answers",
  "rsvp",
  "rsvpCounts",
  "email",
  "gpxHash",
  "sourceHash",
];
function keysOf(value, found = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, found));
  else if (value && typeof value === "object")
    for (const [key, inner] of Object.entries(value)) {
      found.add(key);
      keysOf(inner, found);
    }
  return found;
}

test("DTO: strict schema, no owner fields or row names, geometry only from the public column", async () => {
  const user = await addUser("dto");
  const bike = await addBike(user);
  const segments = [
    [
      [37.1, 55.1],
      [37.2, 55.2],
    ],
    [
      [37.3, 55.3],
      [37.4, 55.35, 120],
    ],
  ];
  const id = await addRide(user, bike, {
    geometry: segments,
    metrics: {
      avgHr: 150,
      maxHr: 181,
      calories: 700,
      activityDate: "2026-09-01",
    },
    visible: ["avgHr", "activityDate"],
  });
  await db.query(
    "UPDATE rides SET elapsed_time_s=3600,moving_time_s=3300,avg_speed_mps='6.5',elevation_gain_m='320.5' WHERE id=$1",
    [id],
  );
  const row = await apiRideRow(db, id, stranger);
  const ride = toRide(row, stranger);
  assert.deepEqual(rideSchema.parse(ride), ride);
  assert.deepEqual(ride.geometry, {
    type: "MultiLineString",
    coordinates: segments,
  });
  assert.deepEqual(ride.bounds, [37.1, 55.1, 37.4, 55.35]);
  assert.deepEqual(ride.metrics, {
    distanceM: 12000,
    elapsedTimeS: 3600,
    movingTimeS: 3300,
    avgSpeedMps: 6.5,
    elevationGainM: 320.5,
  });
  // Only what the author opened, and only numbers.
  assert.deepEqual(ride.extraMetrics, { avgHr: 150 });
  assert.equal(ride.kind, "recorded");
  assert.equal(ride.status, "completed");
  assert.equal(ride.scheduledAt, null);
  assert.equal(ride.participants, null);
  assert.equal(ride.passport, null);
  assert.equal(ride.author.id, user);
  assert.equal(ride.bike.id, bike);
  const keys = keysOf(ride);
  for (const name of forbidden) assert.ok(!keys.has(name), name);
  for (const key of keys) assert.ok(!key.includes("_"), key);

  const summary = toRideSummary(row, stranger);
  assert.deepEqual(rideSummarySchema.parse(summary), summary);
  for (const name of ["geometry", "bounds", "description", "passport"])
    assert.ok(!(name in summary), name + " is not in a list card");
  assert.ok(JSON.stringify(summary).length < JSON.stringify(ride).length);

  // A ride with no public track has no geometry and no bounds.
  const bare = toRide(
    await apiRideRow(db, await addRide(user, bike), null),
    null,
  );
  assert.equal(bare.geometry, null);
  assert.equal(bare.bounds, null);
  // Unknown keys of the stored passport never pass through.
  const plan = await addRide(user, bike, {
    status: "planned",
    startedAt: hours(80),
    passport: {
      pace: "relaxed",
      area: { label: "Центр", center: [37.62, 55.75], radiusM: 5000 },
      distanceKm: { min: 20, max: 40 },
      beginnerFriendly: true,
      secretNote: "не показывать",
    },
  });
  const planned = toRide(await apiRideRow(db, plan, null), null);
  assert.deepEqual(planned.passport, {
    area: { label: "Центр", center: [37.62, 55.75], radiusM: 5000 },
    pace: "relaxed",
    distanceKm: { min: 20, max: 40 },
    beginnerFriendly: true,
  });
  assert.equal(planned.metrics.distanceM, null, "a plan has no distance yet");
  assert.equal(planned.status, "planned");
  assert.equal(planned.kind, "planned");
  assert.ok(planned.scheduledAt);
  assert.equal(planned.startedAt, null);
  assert.deepEqual(rideSchema.parse(planned), planned);
});

const haversine = (a, b) => {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 +
    Math.cos(a[1] * rad) *
      Math.cos(b[1] * rad) *
      Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
};

test("geometry: real points around the start and the end are not in the stored public track", async () => {
  const track = loop.map((point) => [point[0], point[1]]);
  const start = track[0];
  const end = track[track.length - 1];
  const trimmed = publicGeometry([track], true, 500);
  assert.ok(trimmed.flat().length > 10);
  const user = await addUser("zone");
  const bike = await addBike(user);
  const id = await addRide(user, bike, { geometry: trimmed });
  const ride = toRide(await apiRideRow(db, id, null), null);
  const points = ride.geometry.coordinates.flat();
  assert.ok(points.length > 10);
  for (const point of points) {
    assert.ok(haversine(point, start) >= 500, "start zone");
    assert.ok(haversine(point, end) >= 500, "end zone");
  }
  // The bounds are the bounds of what is shown, not of the whole track.
  const lons = points.map((p) => p[0]);
  assert.equal(ride.bounds[0], Math.min(...lons));
  assert.equal(ride.bounds[2], Math.max(...lons));
});
