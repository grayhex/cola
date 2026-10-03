// API v1, rides (#302), through the real server and PostgreSQL: finished and
// upcoming lists, the card, the public series, the meeting point by viewer,
// hidden and called-off rides, comments as one Comment, keyset paging, and the
// sizes of the responses. Tracks are real GPX uploads with a privacy zone.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import { gpx, loop } from "./ride-fixtures.js";
import {
  commentPageSchema,
  errorSchema,
  rideAnalysisSchema,
  ridePageSchema,
  rideSchema,
  replyPageSchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const run = randomUUID().slice(0, 8);
const password = "rides-http-password-123";

async function http(path, { method = "GET", headers = {}, body, origin } = {}) {
  const bytes = Buffer.isBuffer(body);
  const response = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(origin === undefined ? {} : { origin }),
      ...(body === undefined
        ? {}
        : {
            "Content-Type": bytes
              ? "application/octet-stream"
              : "application/json",
          }),
      ...headers,
    },
    body: body === undefined ? undefined : bytes ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    status: response.status,
    body: json,
    text,
    headers: response.headers,
  };
}
async function member(label) {
  const email = `rides-v1-${label}-${run}@example.test`;
  let cookie = "";
  const web = async (path, method = "GET", body) => {
    const r = await http("/api" + path, {
      method,
      body,
      origin: base,
      headers: cookie ? { cookie } : {},
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return r;
  };
  const registered = await web("/auth/register", "POST", {
    ...testConsents,
    name: "Райдер " + label,
    email,
    password,
  });
  assert.equal(registered.status, 201, registered.text);
  await verifyCapturedEmail(email);
  const v1 = (path, options = {}) =>
    http("/api/v1" + path, {
      ...options,
      headers: { cookie, ...(options.headers ?? {}) },
    });
  return { id: registered.body.user.id, web, v1 };
}
const guest = (path, options = {}) => http("/api/v1" + path, options);
const bikeBody = (name, isPublic = true) => ({
  name,
  brand: "Giant",
  model: "Tourer GTS",
  year: 2024,
  category: "road",
  description: "",
  color: "",
  size: "",
  weight: null,
  is_public: isPublic,
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
const forbiddenKeys = [
  "privacyEnabled",
  "privacyRadiusM",
  "pointCount",
  "publicPointCount",
  "isPublic",
  "isOwner",
  "shareId",
  "ownerId",
  "invitations",
  "answers",
  "rsvp",
  "rsvpCounts",
  "email",
  "timestampS",
];
const keysDeep = (value, found = new Set()) => {
  if (Array.isArray(value)) for (const item of value) keysDeep(item, found);
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      keysDeep(child, found);
    }
  return found;
};
function assertClean(label, body, allowed = []) {
  for (const key of keysDeep(body)) {
    assert.ok(
      allowed.includes(key) || !forbiddenKeys.includes(key),
      `${label}: owner key ${key}`,
    );
    assert.ok(!key.includes("_"), `${label}: snake_case key ${key}`);
  }
}
function assertError(response, status, code, label) {
  assert.equal(response.status, status, label + " " + response.text);
  assert.deepEqual(errorSchema.parse(response.body), response.body, label);
  assert.equal(response.body.error.code, code, label);
  assert.equal(response.headers.get("cache-control"), "no-store", label);
}

let shift = 0;
// A real GPX upload; every call moves the track a little so no two collide.
async function uploadRide(who, bikeId, options = {}) {
  const offset = 0.002 * ++shift;
  const track = loop.map((p) => [p[0] + offset, p[1], p[2], p[3]]);
  const preview = await who.web("/rides/preview", "POST", gpx([track]));
  assert.equal(preview.status, 201, preview.text);
  const saved = await who.web("/rides", "POST", {
    previewId: preview.body.previewId,
    bikeId,
    title: options.title ?? "Покатушка " + run,
    description: "Тест",
    isPublic: options.isPublic ?? true,
    privacyEnabled: true,
    privacyRadiusM: 500,
  });
  assert.equal(saved.status, 201, saved.text);
  return { id: saved.body.id, shareId: saved.body.shareId, track };
}
const secret = "Точка у фонтана " + run;
const planFor = (bikeId, extra = {}) => ({
  bikeId,
  title: "План " + run,
  description: "",
  isPublic: true,
  privacyEnabled: false,
  privacyRadiusM: 500,
  scheduledAt: new Date(
    Math.ceil((Date.now() + 50 * 3600000) / 60000) * 60000,
  ).toISOString(),
  recurrence: "none",
  recurrenceTimezone: "Europe/Moscow",
  meetingPoint: secret,
  meetingVisibility: "participants",
  passport: { area: { label: "Район " + run }, pace: "relaxed" },
  ...extra,
});

try {
  const owner = await member("owner");
  const rider = await member("rider");
  const stranger = await member("stranger");
  const barred = await member("barred");
  const publicBike = (
    await owner.web("/bikes", "POST", bikeBody("Публичный " + run))
  ).body.id;
  const privateBike = (
    await owner.web("/bikes", "POST", bikeBody("Закрытый " + run))
  ).body.id;
  const barredBike = (
    await barred.web("/bikes", "POST", bikeBody("Заблокированного " + run))
  ).body.id;

  // ── Fixtures ──────────────────────────────────────────────────────────
  const shown = await uploadRide(owner, publicBike, { title: "Видна " + run });
  const second = await uploadRide(owner, publicBike, {
    title: "Вторая " + run,
  });
  const privateRide = await uploadRide(owner, publicBike, {
    title: "Личная " + run,
    isPublic: false,
  });
  const onPrivateBike = await uploadRide(owner, privateBike, {
    title: "На закрытом " + run,
  });
  // The bike goes private after the ride was published; the ride itself is
  // still marked public, so only the bike's rule hides it.
  await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [privateBike]);
  await db.query("UPDATE rides SET is_public=true WHERE id=$1", [
    onPrivateBike.id,
  ]);
  const barredRide = await uploadRide(barred, barredBike, {
    title: "Заблокированного " + run,
  });
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [barred.id]);
  const plan = await owner.web("/rides/plan", "POST", planFor(publicBike));
  assert.equal(plan.status, 201, plan.text);
  const weeklyPlan = await owner.web(
    "/rides/plan",
    "POST",
    planFor(publicBike, {
      title: "Серия " + run,
      recurrence: "weekly",
      meetingVisibility: "public",
    }),
  );
  assert.equal(weeklyPlan.status, 201, weeklyPlan.text);
  const cancelled = await owner.web(
    "/rides/plan",
    "POST",
    planFor(publicBike, { title: "Отменённый " + run }),
  );
  assert.equal(
    (await owner.web(`/rides/${cancelled.body.id}/cancel`, "POST")).status,
    200,
  );
  const answer = await rider.web(`/rides/${plan.body.id}/rsvp`, "PATCH", {
    response: "accepted",
    occurrenceAt: (await owner.web("/rides/owner/" + plan.body.shareId)).body
      .ride.scheduledAt,
  });
  assert.equal(answer.status, 200, answer.text);

  // ── Finished list ─────────────────────────────────────────────────────
  for (const [label, ask] of [
    ["guest", guest],
    ["stranger", stranger.v1],
    ["owner", owner.v1],
  ]) {
    const list = await ask("/rides?limit=50");
    assert.equal(list.status, 200, list.text);
    assert.equal(list.headers.get("cache-control"), "no-store");
    assert.deepEqual(ridePageSchema.parse(list.body), list.body, label);
    assertClean("list " + label, list.body);
    const ids = list.body.items.map((item) => item.id);
    assert.ok(ids.includes(shown.id) && ids.includes(second.id), label);
    for (const hidden of [
      privateRide.id,
      onPrivateBike.id,
      barredRide.id,
      plan.body.id,
      cancelled.body.id,
    ])
      assert.ok(
        !ids.includes(hidden),
        `${label}: ${hidden} must not be listed`,
      );
    for (const item of list.body.items) {
      assert.equal(item.status, "completed");
      for (const key of ["geometry", "bounds", "description", "passport"])
        assert.ok(!(key in item), "a list card has no " + key);
    }
  }
  const sizeList = (await guest("/rides?limit=2")).text.length;

  // Both tracks carry the same clock; give the second a later start so the
  // order is about start time, not about the ids that break a tie.
  await db.query(
    "UPDATE rides SET started_at=started_at+interval '1 day' WHERE id=$1",
    [second.id],
  );
  // keyset paging over the finished rides of the bike
  const walked = [];
  let cursor = null;
  for (let step = 0; step < 5; step++) {
    const next = await guest(
      `/bikes/${publicBike}/rides?limit=1${cursor ? "&cursor=" + cursor : ""}`,
    );
    assert.equal(next.status, 200, next.text);
    walked.push(...next.body.items.map((item) => item.id));
    cursor = next.body.nextCursor;
    if (!cursor) break;
  }
  assert.deepEqual(new Set(walked), new Set([shown.id, second.id]));
  assert.equal(walked.length, 2, "no repeats");
  assert.deepEqual(walked, [second.id, shown.id], "the later start first");
  assertError(
    await guest("/rides?cursor=nonsense"),
    400,
    "invalid_request",
    "bad cursor",
  );
  assertError(await guest("/rides?limit=0"), 400, "invalid_request", "limit");
  assertError(
    await guest("/rides?sort=asc"),
    400,
    "invalid_request",
    "unknown",
  );

  // bike scope: a private bike is 404 for others; its ride is not public
  assertError(
    await stranger.v1(`/bikes/${privateBike}/rides`),
    404,
    "not_found",
    "private bike",
  );
  assertError(
    await guest(`/bikes/${randomUUID()}/rides`),
    404,
    "not_found",
    "no bike",
  );
  assertError(
    await guest(`/bikes/not-a-uuid/rides`),
    404,
    "not_found",
    "bad id",
  );
  const ownBike = await owner.v1(`/bikes/${privateBike}/rides`);
  assert.equal(ownBike.status, 200);
  assert.deepEqual(
    ownBike.body.items,
    [],
    "the ride of a private bike is not public",
  );

  // ── The card and the privacy zone ─────────────────────────────────────
  for (const ask of [guest, stranger.v1, owner.v1]) {
    const card = await ask("/rides/" + shown.id);
    assert.equal(card.status, 200, card.text);
    assert.deepEqual(rideSchema.parse(card.body), card.body);
    assertClean("card", card.body);
    assert.equal(card.body.geometry.type, "MultiLineString");
    const points = card.body.geometry.coordinates.flat();
    assert.ok(points.length > 10);
    const start = shown.track[0];
    const end = shown.track[shown.track.length - 1];
    for (const point of points) {
      assert.ok(haversine(point, start) >= 500, "start zone");
      assert.ok(haversine(point, end) >= 500, "end zone");
    }
    assert.equal(card.body.passport, null);
    assert.equal(card.body.author.id, owner.id);
  }
  const sizeCard = (await guest("/rides/" + shown.id)).text.length;

  // ── The public series, apart from the card ────────────────────────────
  const analysis = await guest(`/rides/${shown.id}/analysis`);
  assert.equal(analysis.status, 200, analysis.text);
  assert.deepEqual(rideAnalysisSchema.parse(analysis.body), analysis.body);
  // pointCount here is the number of points shown, not of the source track
  assertClean("analysis", analysis.body, ["pointCount"]);
  assert.ok(!("sourcePointCount" in analysis.body));
  assert.ok(analysis.body.pointCount > 0);
  for (const point of analysis.body.segments.flat()) {
    assert.ok(haversine(point.coord, shown.track[0]) >= 500, "series start");
    assert.ok(
      haversine(point.coord, shown.track[shown.track.length - 1]) >= 500,
      "series end",
    );
    for (const sensor of ["hrBpm", "cadenceRpm", "powerW"])
      assert.ok(!(sensor in point), sensor + " was not shown by the author");
  }
  assert.ok(!analysis.body.channels.includes("hrBpm"));
  const sizeAnalysis = analysis.text.length;
  // A plan has no track and no series.
  assertError(
    await guest(`/rides/${plan.body.id}/analysis`),
    404,
    "not_found",
    "plan analysis",
  );

  // ── Hidden, called off and missing look alike ─────────────────────────
  const missing = await guest("/rides/" + randomUUID());
  assertError(missing, 404, "not_found", "missing");
  for (const id of [
    privateRide.id,
    onPrivateBike.id,
    barredRide.id,
    cancelled.body.id,
    "not-a-uuid",
  ])
    for (const [label, ask] of [
      ["guest", guest],
      ["stranger", stranger.v1],
      ["owner", owner.v1],
    ])
      for (const suffix of ["", "/analysis", "/comments"]) {
        const r = await ask(`/rides/${id}${suffix}`);
        assertError(r, 404, "not_found", `${label} ${id}${suffix}`);
        if (suffix !== "/analysis")
          assert.equal(
            r.body.error.message,
            missing.body.error.message,
            "the same words as for a missing ride",
          );
      }

  // ── Upcoming plans and the meeting point ──────────────────────────────
  const upcoming = await guest("/rides/upcoming?limit=50");
  assert.equal(upcoming.status, 200, upcoming.text);
  assert.deepEqual(ridePageSchema.parse(upcoming.body), upcoming.body);
  assertClean("upcoming", upcoming.body);
  const upcomingIds = upcoming.body.items.map((item) => item.id);
  assert.ok(upcomingIds.includes(plan.body.id));
  assert.equal(upcomingIds.filter((id) => id === weeklyPlan.body.id).length, 1);
  assert.ok(!upcomingIds.includes(cancelled.body.id));
  assert.ok(!upcomingIds.includes(shown.id), "finished rides are not upcoming");
  const times = upcoming.body.items.map((item) => Date.parse(item.scheduledAt));
  assert.deepEqual(
    times,
    [...times].sort((a, b) => a - b),
    "soonest first",
  );
  for (const item of upcoming.body.items) {
    assert.equal(item.status, "planned");
    assert.equal(item.startedAt, null);
    assert.ok(!JSON.stringify(item).includes(secret));
  }
  const walkedPlans = [];
  cursor = null;
  for (let step = 0; step < 60; step++) {
    const next = await guest(
      `/rides/upcoming?limit=1${cursor ? "&cursor=" + cursor : ""}`,
    );
    walkedPlans.push(...next.body.items.map((item) => item.id));
    cursor = next.body.nextCursor;
    if (!cursor) break;
  }
  assert.deepEqual(
    walkedPlans,
    upcomingIds,
    "paging by one matches the full list",
  );

  for (const [label, ask, sees] of [
    ["organizer", owner.v1, true],
    ["accepted", rider.v1, true],
    ["stranger", stranger.v1, false],
    ["guest", guest, false],
  ]) {
    const card = await ask("/rides/" + plan.body.id);
    assert.equal(card.status, 200, card.text);
    assert.deepEqual(rideSchema.parse(card.body), card.body);
    assert.equal(card.body.meetingPoint, sees ? secret : null, label);
    assert.equal(card.body.meetingHidden, !sees, label);
    assert.ok(sees || !card.text.includes(secret), label + ": text leaks");
    assert.deepEqual(card.body.participants, { going: 1, maybe: 0 });
    assert.equal(card.body.passport.pace, "relaxed");
    assert.equal(card.body.geometry, null);
    assertClean("plan " + label, card.body);
    assert.ok(
      !card.text.includes(rider.id),
      "no names or ids of those who answered",
    );
  }
  // an organizer's own plan: still just the public card
  assert.equal(
    (await guest("/rides/" + weeklyPlan.body.id)).body.recurrence,
    "weekly",
  );

  // ── Comments: one Comment for a ride too ──────────────────────────────
  const root = await rider.web(`/rides/${shown.id}/comments`, "POST", {
    body: "Хороший маршрут",
  });
  assert.equal(root.status, 201, root.text);
  const rootId = root.body.comment?.id ?? root.body.id;
  for (const text of ["раз", "два", "три", "четыре"]) {
    const reply = await owner.web(`/rides/${shown.id}/comments`, "POST", {
      body: text,
      parentId: rootId,
    });
    assert.equal(reply.status, 201, reply.text);
  }
  const comments = await guest(`/rides/${shown.id}/comments`);
  assert.equal(comments.status, 200, comments.text);
  assert.deepEqual(commentPageSchema.parse(comments.body), comments.body);
  assertClean("comments", comments.body);
  assert.equal(comments.body.items.length, 1);
  assert.equal(comments.body.items[0].comment.body, "Хороший маршрут");
  assert.equal(comments.body.items[0].comment.replyCount, 4);
  assert.equal(comments.body.items[0].replies.length, 3, "a preview of three");
  const replies = await guest(`/rides/${shown.id}/comments/${rootId}/replies`);
  assert.equal(replies.status, 200, replies.text);
  assert.deepEqual(replyPageSchema.parse(replies.body), replies.body);
  assert.equal(replies.body.items.length, 4);
  const focused = await guest(
    `/rides/${shown.id}/comments?focus=${replies.body.items[3].id}`,
  );
  assert.equal(focused.status, 200, focused.text);
  assert.equal(focused.body.focusPath.length, 2);
  assertError(
    await guest(`/rides/${shown.id}/comments?focus=${rootId}&cursor=x`),
    400,
    "invalid_request",
    "focus with cursor",
  );
  // The legacy engine would still let a called-off ride's comments through.
  assertError(
    await guest(`/rides/${cancelled.body.id}/comments`),
    404,
    "not_found",
    "comments of a called-off ride",
  );

  // ── Transport rules, Bearer, legacy unchanged ─────────────────────────
  for (const path of [
    "/rides",
    "/rides/upcoming",
    `/rides/${shown.id}`,
    `/rides/${shown.id}/analysis`,
    `/rides/${shown.id}/comments`,
    `/rides/${shown.id}/comments/${rootId}/replies`,
    `/bikes/${publicBike}/rides`,
  ]) {
    // A comment collection takes POST since W1 (#330): its own tests.
    for (const method of /\/comments$/.test(path)
      ? ["PUT", "PATCH", "DELETE"]
      : ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await guest(path, { method, origin: base });
      assertError(r, 405, "method_not_allowed", method + " " + path);
      assert.match(r.headers.get("allow"), /GET/);
    }
    const bad = await guest(path, {
      headers: { Authorization: "Bearer cola_at_" + "A".repeat(43) },
    });
    assertError(bad, 401, "invalid_token", "bad Bearer " + path);
  }
  const legacy = await http(`/api/rides?status=planned`);
  assert.equal(legacy.status, 200);
  assert.ok(
    "total" in legacy.body && "page" in legacy.body && "rides" in legacy.body,
    "legacy keeps OFFSET paging",
  );
  const legacyDetail = await http("/api/rides/public/" + shown.shareId);
  assert.equal(legacyDetail.status, 200);
  assert.equal(legacyDetail.body.ride.id, shown.id);

  // A long track, for the record: how big a card and a series get.
  const longBike = (
    await owner.web("/bikes", "POST", bikeBody("Дальний " + run))
  ).body.id;
  const longTrack = Array.from({ length: 4000 }, (_, i) => [
    37.5 + Math.sin((i / 4000) * Math.PI * 6) * 0.05,
    55.7 + Math.cos((i / 4000) * Math.PI * 4) * 0.03,
    i * 8,
    120 + (i % 200) / 4,
  ]);
  const longPreview = await owner.web(
    "/rides/preview",
    "POST",
    gpx([longTrack]),
  );
  assert.equal(longPreview.status, 201, longPreview.text);
  const longSaved = await owner.web("/rides", "POST", {
    previewId: longPreview.body.previewId,
    bikeId: longBike,
    title: "Длинная " + run,
    description: "",
    isPublic: true,
    privacyEnabled: true,
    privacyRadiusM: 500,
  });
  assert.equal(longSaved.status, 201, longSaved.text);
  const longCard = await guest("/rides/" + longSaved.body.id);
  const longSeries = await guest(`/rides/${longSaved.body.id}/analysis`);
  assert.equal(longCard.status, 200, longCard.text);
  assert.deepEqual(rideSchema.parse(longCard.body), longCard.body);
  assert.deepEqual(rideAnalysisSchema.parse(longSeries.body), longSeries.body);
  const longList = await guest(`/bikes/${longBike}/rides`);
  console.log(
    `long track (4000 points): list card ${JSON.stringify(longList.body.items[0]).length} bytes, ride card ${longCard.text.length} bytes (geometry ${longCard.body.geometry.coordinates.flat().length} points), analysis ${longSeries.text.length} bytes (${longSeries.body.pointCount} points)`,
  );
  console.log(
    `sizes: finished list of 2 cards ${sizeList} bytes, ride card ${sizeCard} bytes, analysis ${sizeAnalysis} bytes`,
  );
  console.log(
    "PASS: API v1 rides: lists, card, privacy zone, series, meeting point, hidden and called-off rides, comments, paging and legacy unchanged.",
  );
} finally {
  await db.end();
}
