// API v1, personal reads (#321), through the real server and PostgreSQL: the
// notices of the person asking (made by real likes, follows and comments), the
// count, and the saved entries and listings; only for the person, by cookie
// and by token, with the site's visibility at read time.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import {
  errorSchema,
  feedPageSchema,
  journalPageSchema,
  marketPageSchema,
  notificationCountSchema,
  myUpcomingRidesSchema,
  notificationPageSchema,
  ownRidePageSchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const run = randomUUID().slice(0, 8);
const password = "personal-http-password-123";

async function http(path, { method = "GET", headers = {}, body, origin } = {}) {
  const response = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(origin === undefined ? {} : { origin }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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
async function member(label, verified = true) {
  const email = `personal-${label}-${run}@example.test`;
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
  if (verified) await verifyCapturedEmail(email);
  // A cookie request, with the Origin the site sends unless a test says otherwise.
  const withCookie = (path, options = {}) =>
    http("/api/v1" + path, {
      origin: base,
      ...options,
      headers: { cookie, ...(options.headers ?? {}) },
    });
  // A native client: a device session, a Bearer token and no Origin at all.
  const grant = await http("/api/v1/auth/sessions", {
    method: "POST",
    body: {
      email,
      password,
      device: { name: "Телефон " + label, platform: "ios" },
    },
  });
  assert.equal(grant.status, 201, grant.text);
  const withToken = (path, options = {}) =>
    http("/api/v1" + path, {
      ...options,
      headers: {
        authorization: "Bearer " + grant.body.accessToken,
        ...(options.headers ?? {}),
      },
    });
  return {
    id: registered.body.user.id,
    username: registered.body.user.username,
    web,
    cookieValue: () => cookie,
    bearer: async () => "Bearer " + grant.body.accessToken,
    cookie: withCookie,
    token: withToken,
  };
}
const guest = (path, options = {}) => http("/api/v1" + path, options);
function assertError(r, status, code, label) {
  assert.equal(r.status, status, label + " " + r.text);
  assert.deepEqual(errorSchema.parse(r.body), r.body, label);
  assert.equal(r.body.error.code, code, label);
  assert.equal(r.headers.get("cache-control"), "no-store", label);
}
const bikeBody = (name) => ({
  name,
  brand: "Cube",
  model: "Nuroad",
  year: 2024,
  category: "gravel",
  description: "",
  color: "",
  size: "",
  weight: null,
  is_public: true,
});
const idsOf = (r) => r.body.items.map((item) => item.id);

try {
  const me = await member("me");
  const actor = await member("actor");
  const stranger = await member("stranger");
  const bike = (await me.web("/bikes", "POST", bikeBody("Мой " + run))).body.id;
  const theirs = (await actor.web("/bikes", "POST", bikeBody("Чужой " + run)))
    .body.id;

  // Notices made the way people make them.
  assert.equal(
    (await actor.token(`/users/${me.username}/follow`, { method: "PUT" }))
      .status,
    200,
  );
  assert.equal(
    (await actor.token(`/bikes/${bike}/like`, { method: "PUT" })).status,
    200,
  );
  const commented = await actor.web(
    `/community/bikes/${bike}/comments`,
    "POST",
    { body: "Классный велосипед" },
  );
  assert.equal(commented.status, 201, commented.text);

  assertError(
    await guest("/me/notifications"),
    401,
    "unauthorized",
    "guest notices",
  );
  assertError(
    await guest("/me/notifications/count"),
    401,
    "unauthorized",
    "guest count",
  );
  assertError(
    await guest("/me/saved/journal"),
    401,
    "unauthorized",
    "guest saved journal",
  );
  assertError(
    await guest("/me/saved/market"),
    401,
    "unauthorized",
    "guest saved market",
  );

  const notices = await me.token("/me/notifications");
  assert.equal(notices.status, 200, notices.text);
  notificationPageSchema.parse(notices.body);
  assert.equal(notices.headers.get("cache-control"), "no-store");
  assert.deepEqual(notices.body.items.map((item) => item.type).sort(), [
    "comment",
    "follow",
    "like",
  ]);
  const follow = notices.body.items.find((item) => item.type === "follow");
  assert.equal(follow.actor.username, actor.username);
  assert.equal(follow.target.path, "/@" + actor.username);
  const comment = notices.body.items.find((item) => item.type === "comment");
  assert.match(comment.target.path, /^\/b\/.+\?comment=.+#discussion$/);
  assert.ok(!notices.text.includes("@example.test"));
  // By cookie as well.
  assert.deepEqual(idsOf(await me.cookie("/me/notifications")), idsOf(notices));
  // A walk by cursor is the whole list in the same order.
  const walked = [];
  let cursor = null;
  for (let guardian = 0; guardian < 6; guardian++) {
    const r = await me.token(
      "/me/notifications?limit=1" + (cursor ? "&cursor=" + cursor : ""),
    );
    assert.equal(r.status, 200, r.text);
    walked.push(...idsOf(r));
    if (!r.body.nextCursor) break;
    cursor = r.body.nextCursor;
  }
  assert.deepEqual(walked, idsOf(notices));
  assertError(
    await me.token("/me/notifications?cursor=garbage"),
    400,
    "invalid_request",
    "cursor",
  );
  assertError(
    await me.token("/me/notifications?limit=0"),
    400,
    "invalid_request",
    "limit",
  );
  assertError(
    await me.token("/me/notifications?page=2"),
    400,
    "invalid_request",
    "page",
  );
  // Nobody else's notices.
  assert.deepEqual(idsOf(await stranger.token("/me/notifications")), []);
  assert.deepEqual(idsOf(await actor.token("/me/notifications")), []);
  // The count, as the site's.
  const count = await me.token("/me/notifications/count");
  const counted = notificationCountSchema.parse(count.body);
  assert.deepEqual(
    { unread: counted.unread, capped: counted.capped },
    { unread: 3, capped: false },
  );
  // The mark "read all" counts up to (#341) is the same one the list carries.
  assert.equal(typeof counted.watermark, "string");
  assert.equal(counted.watermark, notices.body.watermark);
  assert.equal((await me.web("/community/notifications/count")).body.unread, 3);
  for (const query of ["?limit=0", "?foo=bar"])
    assertError(
      await me.token("/me/notifications/count" + query),
      400,
      "invalid_request",
      "count takes no parameters " + query,
    );
  // Withdrawn like: no notice. A private bike: no notices about it.
  await actor.token(`/bikes/${bike}/like`, { method: "DELETE" });
  assert.deepEqual(
    (await me.token("/me/notifications")).body.items
      .map((item) => item.type)
      .sort(),
    ["comment", "follow"],
  );
  assert.equal((await me.token("/me/notifications/count")).body.unread, 2);
  await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [bike]);
  assert.deepEqual(
    (await me.token("/me/notifications")).body.items.map((item) => item.type),
    ["follow"],
  );
  await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [bike]);
  // Read on the site: the API sees it.
  assert.equal(
    (await me.web("/community/notifications/read-all", "PATCH")).status,
    200,
  );
  assert.equal((await me.token("/me/notifications/count")).body.unread, 0);
  assert.ok(
    (await me.token("/me/notifications")).body.items.every(
      (item) => item.readAt,
    ),
  );

  // Saved entries of a public bike of somebody else.
  const entries = [];
  for (let i = 0; i < 3; i++) {
    const id = randomUUID();
    entries.push(id);
    await db.query(
      `INSERT INTO journal_entries(id,share_id,owner_id,bike_id,kind,title,body,status,is_public,event_date,mileage,components,created_at,updated_at)
       VALUES($1,$2,$3,$4,'build',$5,'Текст записи','published',true,'2026-08-30',100,'[]'::jsonb,now(),now())`,
      [id, randomUUID(), actor.id, theirs, "Запись " + i],
    );
  }
  for (const id of entries.slice(0, 2))
    assert.equal(
      (await me.token(`/journal/${id}/save`, { method: "PUT" })).status,
      200,
    );
  const savedEntries = await me.token("/me/saved/journal?limit=1");
  assert.equal(savedEntries.status, 200, savedEntries.text);
  journalPageSchema.parse(savedEntries.body);
  assert.deepEqual(idsOf(savedEntries), [entries[1]], "newest save first");
  const rest = await me.token(
    "/me/saved/journal?limit=1&cursor=" + savedEntries.body.nextCursor,
  );
  assert.deepEqual(idsOf(rest), [entries[0]]);
  assert.equal(rest.body.nextCursor, null);
  assert.deepEqual(idsOf(await me.cookie("/me/saved/journal")), [
    entries[1],
    entries[0],
  ]);
  assert.deepEqual(idsOf(await stranger.token("/me/saved/journal")), []);
  assert.equal((await me.web("/community/saved")).body.entries.length, 2);
  // Unpublished: still saved, not shown.
  await db.query("UPDATE journal_entries SET status='draft' WHERE id=$1", [
    entries[1],
  ]);
  assert.deepEqual(idsOf(await me.token("/me/saved/journal")), [entries[0]]);

  // Saved listings.
  const listings = [];
  for (let i = 0; i < 2; i++) {
    const id = randomUUID();
    listings.push(id);
    await db.query(
      `INSERT INTO market_listings(id,share_id,owner_id,title,description,category,condition,price,currency,location,contact,status,listing_type,published_at,expires_at)
       VALUES($1,$2,$3,$4,'Описание','components','used',100,'RUB','Москва','tg: @x','active','sale',now(),now()+interval '30 days')`,
      [id, randomUUID(), actor.id, "Лот " + i + " " + run],
    );
  }
  for (const id of listings)
    assert.equal(
      (await me.token(`/market/${id}/save`, { method: "PUT" })).status,
      200,
    );
  const savedListings = await me.token("/me/saved/market");
  assert.equal(savedListings.status, 200, savedListings.text);
  marketPageSchema.parse(savedListings.body);
  assert.deepEqual(idsOf(savedListings), [listings[1], listings[0]]);
  assert.ok(savedListings.body.items.every((item) => !("contact" in item)));
  assert.deepEqual(idsOf(await me.token("/me/saved/market?limit=1")), [
    listings[1],
  ]);
  assert.deepEqual(idsOf(await stranger.token("/me/saved/market")), []);
  await db.query("UPDATE market_listings SET status='sold' WHERE id=$1", [
    listings[1],
  ]);
  assert.deepEqual(idsOf(await me.token("/me/saved/market")), [listings[0]]);

  // Own rides: every state, only mine, whatever the bike's privacy.
  const hours = (n) => new Date(Date.now() + n * 3600000).toISOString();
  const addRide = async (owner, bikeId, options = {}) => {
    const id = randomUUID();
    const status = options.status ?? "completed";
    const planned = status !== "completed";
    await db.query(
      `INSERT INTO rides(id,share_id,owner_id,bike_id,title,description,status,source_kind,has_track,is_public,started_at,distance_m,point_count,public_point_count,public_geometry,privacy_enabled,privacy_radius_m,source_hash,recurrence,meeting_point,meeting_visibility,plan_passport,import_metrics)
       VALUES($1,$1,$2,$3,$4,'описание',$5,$6,false,$7,$8,$9,2,2,'[]',true,500,$10,'none',$11,$12,'{}','{}')`,
      [
        id,
        owner,
        bikeId,
        options.title ?? "Покатушка " + id.slice(0, 6),
        status,
        planned ? "planned" : "gpx",
        options.isPublic ?? true,
        options.startedAt ?? hours(-48),
        planned ? 0 : 12000,
        "fixture-" + id,
        options.meeting ?? "",
        options.visibility ?? "public",
      ],
    );
    return id;
  };
  const rides = [
    await addRide(me.id, bike, { startedAt: hours(-10) }),
    await addRide(me.id, bike, { startedAt: hours(-20), isPublic: false }),
    await addRide(me.id, bike, {
      status: "planned",
      startedAt: hours(30),
      meeting: "Мост",
      visibility: "participants",
    }),
  ];
  await addRide(actor.id, theirs);
  assertError(await guest("/me/rides"), 401, "unauthorized", "guest rides");
  assertError(
    await guest("/me/rides/upcoming"),
    401,
    "unauthorized",
    "guest upcoming",
  );
  const mine = await me.token("/me/rides");
  assert.equal(mine.status, 200, mine.text);
  ownRidePageSchema.parse(mine.body);
  assert.deepEqual(new Set(idsOf(mine)), new Set(rides));
  assert.equal(mine.body.items.filter((item) => !item.isPublic).length, 1);
  assert.ok(
    mine.body.items.every(
      (item) => item.privacyEnabled && item.privacyRadiusM === 500,
    ),
  );
  assert.deepEqual(idsOf(await me.cookie("/me/rides")), idsOf(mine));
  const ridesWalk = [];
  let ridesCursor = null;
  for (let guardian = 0; guardian < 6; guardian++) {
    const r = await me.token(
      "/me/rides?limit=1" + (ridesCursor ? "&cursor=" + ridesCursor : ""),
    );
    assert.equal(r.status, 200, r.text);
    ridesWalk.push(...idsOf(r));
    if (!r.body.nextCursor) break;
    ridesCursor = r.body.nextCursor;
  }
  assert.deepEqual(ridesWalk, idsOf(mine));
  assert.deepEqual(idsOf(await stranger.token("/me/rides")), []);
  assertError(
    await me.token("/me/rides?page=2"),
    400,
    "invalid_request",
    "rides page",
  );
  assertError(
    await me.token("/me/rides?cursor=garbage"),
    400,
    "invalid_request",
    "rides cursor",
  );
  // The public list never has the private one, and the owner's fields stay out of it.
  const publicRides = await guest("/rides");
  assert.ok(!idsOf(publicRides).includes(rides[1]));
  assert.ok(
    !publicRides.text.includes("privacyRadiusM") &&
      !publicRides.text.includes("pointCount"),
  );

  // Upcoming plans with a role; the meeting point by the participants' rule.
  const plan = await addRide(actor.id, theirs, {
    status: "planned",
    startedAt: hours(10),
    meeting: "У фонтана",
    visibility: "participants",
  });
  await db.query(
    "INSERT INTO ride_invitations(ride_id,user_id) VALUES($1,$2)",
    [plan, me.id],
  );
  const upcoming = await me.token("/me/rides/upcoming");
  assert.equal(upcoming.status, 200, upcoming.text);
  myUpcomingRidesSchema.parse(upcoming.body);
  assert.deepEqual(idsOf(upcoming), [plan, rides[2]], "soonest first");
  assert.deepEqual(
    upcoming.body.items.map((item) => item.role),
    ["invited", "organizer"],
  );
  assert.equal(upcoming.body.items[0].meetingPoint, null);
  assert.equal(upcoming.body.items[0].meetingHidden, true);
  assert.equal(upcoming.body.items[1].meetingPoint, "Мост");
  const when = (
    await db.query("SELECT started_at FROM rides WHERE id=$1", [plan])
  ).rows[0].started_at;
  await db.query(
    "INSERT INTO ride_rsvps(ride_id,user_id,occurs_at,response) VALUES($1,$2,$3,'accepted')",
    [plan, me.id, when],
  );
  const accepted = await me.cookie("/me/rides/upcoming");
  assert.equal(accepted.body.items[0].role, "accepted");
  assert.equal(accepted.body.items[0].meetingPoint, "У фонтана");
  assert.deepEqual(idsOf(await stranger.token("/me/rides/upcoming")), []);
  assertError(
    await me.token("/me/rides/upcoming?limit=5"),
    400,
    "invalid_request",
    "upcoming takes no parameters",
  );
  assert.ok(!accepted.text.includes("@example.test"));

  // The feed: what a followed person publishes, newest first.
  const feedAuthor = await member("feed-author");
  assert.equal(
    (await me.token(`/users/${feedAuthor.username}/follow`, { method: "PUT" }))
      .status,
    200,
  );
  const feedBike = (
    await feedAuthor.web("/bikes", "POST", bikeBody("Лента " + run))
  ).body.id;
  const feedEntry = randomUUID();
  await db.query(
    `INSERT INTO journal_entries(id,share_id,owner_id,bike_id,kind,title,body,status,is_public,event_date,mileage,components,created_at,updated_at,published_at)
     VALUES($1,$2,$3,$4,'build','Запись ленты','Текст','published',true,'2026-08-30',100,'[]'::jsonb,now(),now(),now()+interval '1 minute')`,
    [feedEntry, randomUUID(), feedAuthor.id, feedBike],
  );
  const feedRide = await addRide(feedAuthor.id, feedBike, {
    startedAt: hours(-5),
  });
  await db.query(
    "UPDATE rides SET published_at=now()+interval '2 minutes' WHERE id=$1",
    [feedRide],
  );
  const feedListing = randomUUID();
  await db.query(
    `INSERT INTO market_listings(id,share_id,owner_id,title,description,category,condition,price,currency,location,contact,status,listing_type,published_at,expires_at)
     VALUES($1,$2,$3,$4,'Описание','components','used',100,'RUB','Москва','tg: @x','active','sale',now()+interval '3 minutes',now()+interval '30 days')`,
    [feedListing, randomUUID(), feedAuthor.id, "Лот ленты " + run],
  );
  assertError(await guest("/me/feed"), 401, "unauthorized", "guest feed");
  const feed = await me.token("/me/feed");
  assert.equal(feed.status, 200, feed.text);
  feedPageSchema.parse(feed.body);
  const feedIds = feed.body.items.map(
    (item) => (item.bike ?? item.ride ?? item.journal ?? item.listing).id,
  );
  assert.deepEqual(
    feedIds,
    [feedListing, feedRide, feedEntry, feedBike],
    "newest first",
  );
  assert.deepEqual(
    feed.body.items.map((item) => item.type),
    ["market", "ride", "journal", "bike"],
  );
  assert.ok(
    feed.body.items.every(
      (item) =>
        [item.bike, item.ride, item.journal, item.listing].filter(Boolean)
          .length === 1,
    ),
  );
  assert.ok(
    !feed.text.includes("contact") && !feed.text.includes("@example.test"),
  );
  assert.deepEqual((await me.cookie("/me/feed")).body, feed.body);
  const feedWalk = [];
  let feedCursor = null;
  for (let guardian = 0; guardian < 8; guardian++) {
    const r = await me.token(
      "/me/feed?limit=1" + (feedCursor ? "&cursor=" + feedCursor : ""),
    );
    assert.equal(r.status, 200, r.text);
    feedWalk.push(
      ...r.body.items.map(
        (item) => (item.bike ?? item.ride ?? item.journal ?? item.listing).id,
      ),
    );
    if (!r.body.nextCursor) break;
    feedCursor = r.body.nextCursor;
  }
  assert.deepEqual(feedWalk, feedIds);
  const onlyRides = await me.token("/me/feed?type=rides");
  assert.deepEqual(
    onlyRides.body.items.map((item) => item.type),
    ["ride"],
  );
  const onlyJournal = await me.token("/me/feed?type=journal");
  assert.deepEqual(
    onlyJournal.body.items.map((item) => item.type),
    ["journal"],
  );
  assert.deepEqual((await stranger.token("/me/feed")).body.items, []);
  assertError(
    await me.token("/me/feed?type=market"),
    400,
    "invalid_request",
    "feed type",
  );
  assertError(
    await me.token("/me/feed?mode=new"),
    400,
    "invalid_request",
    "feed mode",
  );
  assertError(
    await me.token("/me/feed?cursor=garbage"),
    400,
    "invalid_request",
    "feed cursor",
  );
  // A bike made private takes its entries and rides out of the feed.
  await db.query("UPDATE bikes SET is_public=false WHERE id=$1", [feedBike]);
  assert.deepEqual(
    (await me.token("/me/feed")).body.items.map((item) => item.type),
    ["market"],
  );
  await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [feedBike]);
  // Stop following: an empty feed.
  assert.equal(
    (
      await me.token(`/users/${feedAuthor.username}/follow`, {
        method: "DELETE",
      })
    ).status,
    200,
  );
  assert.deepEqual((await me.token("/me/feed")).body.items, []);

  // Methods and credentials.
  assertError(
    await me.token("/me/notifications", { method: "POST", body: {} }),
    405,
    "method_not_allowed",
    "POST",
  );
  assertError(
    await me.token("/me/saved/market", { method: "DELETE" }),
    405,
    "method_not_allowed",
    "DELETE",
  );
  assertError(
    await guest("/me/notifications", {
      headers: { authorization: "Bearer cola_at_nope" },
    }),
    401,
    "invalid_token",
    "bad token",
  );

  console.log("api v1 personal http: ok");
} finally {
  await db.end();
}
