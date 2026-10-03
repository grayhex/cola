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
  journalPageSchema,
  marketPageSchema,
  notificationCountSchema,
  notificationPageSchema,
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
  assert.deepEqual(notificationCountSchema.parse(count.body), {
    unread: 3,
    capped: false,
  });
  assert.equal((await me.web("/community/notifications/count")).body.unread, 3);
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
