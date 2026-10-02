import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildOpenApiDocument } from "../lib/api-v1/openapi.ts";
import {
  bikePageSchema,
  bikeSchema,
  errorSchema,
  meSchema,
} from "../lib/api-v1/schemas.ts";

// API v1, first slice (#134), through the real server, PostgreSQL and the
// session cookie the web app uses. The rules themselves are unit-tested in
// api-v1.test.js; this checks the HTTP layer and that legacy still works.

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const nonce = randomUUID().slice(0, 8);

// A browser: one cookie jar for the legacy API and /api/v1 alike.
function client() {
  let cookie = "";
  const api = async (url, method = "GET", data) => {
    const response = await fetch(base + "/api/" + url, {
      method,
      headers: {
        origin: base,
        ...(cookie ? { cookie } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: response.status, body: await response.json() };
  };
  api.v1 = async (path, { method = "GET", headers = {}, cookies } = {}) => {
    const response = await globalThis.fetch(base + "/api/v1" + path, {
      method,
      headers: {
        ...(cookies === false ? {} : cookie ? { cookie } : {}),
        ...headers,
      },
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      text,
      body: text ? JSON.parse(text) : null,
    };
  };
  api.cookie = () => cookie;
  return api;
}
async function member(label) {
  const api = client();
  const email = `v1-${label}-${nonce}@example.test`;
  const registered = await api("auth/register", "POST", {
    ...testConsents,
    name: label + " " + nonce,
    email,
    password: "api-v1-secret-123",
  });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  return { api, id: registered.body.user.id, email };
}
const bikeInput = (name, extra = {}) => ({
  name,
  brand: "Cube",
  model: "Nuroad",
  year: 2024,
  category: "gravel",
  description: "",
  color: "",
  size: "",
  weight: 9.5,
  is_public: true,
  ...extra,
});
async function createBike(person, name, extra) {
  const created = await person.api("bikes", "POST", bikeInput(name, extra));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.id;
}
const keysDeep = (value, found = new Set()) => {
  if (Array.isArray(value)) for (const item of value) keysDeep(item, found);
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      keysDeep(child, found);
    }
  return found;
};
const hidden = [
  "owner_id",
  "share_id",
  "public_id",
  "factory_spec",
  "password_hash",
  "token_hash",
  "user_agent",
  "preferences",
  "blocked",
  "avatar_id",
];
function assertNoLeak(label, body) {
  for (const key of keysDeep(body)) {
    assert.doesNotMatch(key, /_/, `${label}: snake_case key ${key}`);
    assert.ok(!hidden.includes(key), `${label}: hidden key ${key}`);
  }
}
function assertError(response, status, code, label) {
  assert.equal(response.status, status, label + " " + response.text);
  assert.deepEqual(errorSchema.parse(response.body), response.body, label);
  assert.equal(response.body.error.code, code, label);
  assert.equal(response.headers.get("cache-control"), "no-store", label);
  assert.ok(response.headers.get("x-request-id"), label + ": request id");
}

try {
  const guest = client();
  const owner = await member("owner");
  const reader = await member("reader");
  const barred = await member("barred");
  const leaver = await member("leaver");

  // ---- Fixtures: public bikes, one private, a blocked owner's, parts, photo.
  const first = await createBike(owner, "Первый " + nonce, {
    price: 500000,
    show_bike_price: false,
  });
  const publicIds = [first];
  for (const n of [2, 3, 4])
    publicIds.push(
      await createBike(owner, `Байк ${n} ${nonce}`, { category: "mtb" }),
    );
  const secret = await createBike(owner, "Закрытый " + nonce, {
    is_public: false,
    price: 123456,
  });
  const barredBike = await createBike(barred, "Заблокированного " + nonce);
  await db.query(
    "INSERT INTO components(id,bike_id,section,category,name,price) VALUES($1,$2,'build','Рама','Frame X',1234.5)",
    [randomUUID(), first],
  );
  const photo = randomUUID();
  await db.query(
    "INSERT INTO photos(id,bike_id,filename,is_cover) VALUES($1,$2,$3,true)",
    [photo, first, "api-v1-" + photo + ".webp"],
  );
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [barred.id]);

  // ---- The document.
  const served = await guest.v1("/openapi.json", { cookies: false });
  assert.equal(served.status, 200);
  assert.match(served.headers.get("content-type"), /application\/json/);
  assert.match(served.headers.get("cache-control"), /public/);
  assert.deepEqual(
    served.body,
    JSON.parse(JSON.stringify(buildOpenApiDocument(base))),
    "the served document is the one the code builds",
  );
  assert.equal(served.body.openapi, "3.1.0");
  assert.equal(served.body.servers[0].url, base + "/api/v1");
  // Every documented operation exists on the server.
  for (const [route, methods] of Object.entries(served.body.paths))
    for (const method of Object.keys(methods)) {
      const response = await guest.v1(route.replace("{id}", first), {
        method: method.toUpperCase(),
      });
      assert.ok(
        [200, 401].includes(response.status),
        `${method} ${route} is implemented (${response.status})`,
      );
    }

  // ---- GET /me
  assertError(await guest.v1("/me"), 401, "unauthorized", "guest /me");
  assertError(
    await guest.v1("/me", {
      headers: { cookie: "cola_session=" + "A".repeat(43) },
    }),
    401,
    "unauthorized",
    "unknown session",
  );
  assertError(
    await guest.v1("/me", { headers: { cookie: "cola_session=short" } }),
    401,
    "unauthorized",
    "malformed session",
  );
  for (const authorization of ["Bearer abc.def", "Basic Zm9vOmJhcg=="]) {
    assertError(
      await guest.v1("/me", { headers: { authorization } }),
      401,
      "unsupported_authentication",
      "Authorization without a cookie",
    );
    assertError(
      await owner.api.v1("/me", { headers: { authorization } }),
      401,
      "unsupported_authentication",
      "Authorization with a valid cookie is refused, not ignored",
    );
  }
  const me = await owner.api.v1("/me");
  assert.equal(me.status, 200, me.text);
  assert.deepEqual(meSchema.parse(me.body), me.body);
  assert.equal(me.body.id, owner.id);
  assert.equal(me.body.email, owner.email);
  assert.equal(me.headers.get("cache-control"), "no-store");
  assert.ok(me.headers.get("x-request-id"));
  assertNoLeak("me", me.body);

  // ---- GET /bikes: public list, stable paging, «mine», errors.
  // The database is shared with every other HTTP test, so the list is scoped
  // to this run's fixtures: all of them carry the nonce in a name.
  const scoped = "q=" + nonce;
  const everything = await guest.v1(`/bikes?${scoped}&limit=50`, {
    cookies: false,
  });
  assert.equal(everything.status, 200, everything.text);
  assert.deepEqual(bikePageSchema.parse(everything.body), everything.body);
  assertNoLeak("list", everything.body);
  const listed = everything.body.items.map((bike) => bike.id);
  assert.deepEqual(
    [...listed].sort(),
    [...publicIds].sort(),
    "exactly the owner's public bikes",
  );
  assert.ok(!listed.includes(secret), "a private bike is never listed");
  assert.ok(
    !listed.includes(barredBike),
    "a blocked owner's bike is never listed",
  );
  assert.equal(everything.body.nextCursor, null);
  assert.ok(everything.body.items.every((bike) => bike.isOwner === false));
  assert.ok(everything.body.items.every((bike) => bike.isPublic === true));

  const walked = [];
  let cursor = null,
    pages = 0;
  do {
    const page = await guest.v1(
      `/bikes?${scoped}&limit=1` +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      { cookies: false },
    );
    assert.equal(page.status, 200, page.text);
    assert.equal(page.body.items.length, 1);
    walked.push(page.body.items[0].id);
    cursor = page.body.nextCursor;
    assert.ok(++pages < 100, "the cursor ends");
  } while (cursor);
  assert.equal(
    pages,
    publicIds.length,
    "one page per bike, no empty last page",
  );
  assert.deepEqual(
    walked,
    listed,
    "paging by cursor equals one big page: no repeat, no gap",
  );

  const filtered = await guest.v1(`/bikes?${scoped}&category=mtb&limit=50`, {
    cookies: false,
  });
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.items.length, 3);
  assert.ok(filtered.body.items.every((bike) => bike.category === "mtb"));
  const searched = await guest.v1(
    "/bikes?q=" + encodeURIComponent("Первый " + nonce),
    {
      cookies: false,
    },
  );
  assert.deepEqual(
    searched.body.items.map((bike) => bike.id),
    [first],
  );

  assertError(
    await guest.v1("/bikes?scope=mine"),
    401,
    "unauthorized",
    "guest mine",
  );
  const mine = await owner.api.v1("/bikes?scope=mine&limit=50");
  assert.equal(mine.status, 200, mine.text);
  assert.deepEqual(bikePageSchema.parse(mine.body), mine.body);
  const mineIds = mine.body.items.map((bike) => bike.id);
  assert.ok(
    mineIds.includes(secret),
    "«mine» includes the owner's private bike",
  );
  assert.ok(mine.body.items.every((bike) => bike.isOwner));
  assert.ok(!mineIds.includes(barredBike));
  const theirs = await reader.api.v1("/bikes?scope=mine&limit=50");
  assert.deepEqual(theirs.body.items, [], "nobody else's bikes are «mine»");
  const asReader = await reader.api.v1(`/bikes?${scoped}&limit=50`);
  assert.ok(!asReader.body.items.map((bike) => bike.id).includes(secret));

  for (const query of [
    "?limit=0",
    "?limit=51",
    "?limit=abc",
    "?limit=1&limit=2",
    "?scope=all",
    "?category=nope",
    "?q=" + "a".repeat(151),
    "?cursor=garbage",
    "?cursor=" +
      encodeURIComponent(
        Buffer.from('{"t":"x","i":"y"}').toString("base64url"),
      ),
    "?page=2",
  ]) {
    const response = await guest.v1("/bikes" + query, { cookies: false });
    assertError(response, 400, "invalid_request", "GET /bikes" + query);
    assert.ok(response.body.error.details.length, "details say what is wrong");
  }
  assertError(
    await owner.api.v1("/bikes?limit=2", {
      headers: { authorization: "Bearer x" },
    }),
    401,
    "unsupported_authentication",
    "list with Authorization",
  );

  // ---- GET /bikes/{id}: public, private, hidden prices, blocked owner.
  const asGuest = await guest.v1("/bikes/" + first, { cookies: false });
  assert.equal(asGuest.status, 200, asGuest.text);
  assert.deepEqual(bikeSchema.parse(asGuest.body), asGuest.body);
  assertNoLeak("detail (guest)", asGuest.body);
  assert.equal(asGuest.body.isOwner, false);
  assert.equal(asGuest.body.price, null, "a hidden price is null for others");
  assert.equal(asGuest.body.components[0].price, null);
  assert.equal(asGuest.body.priceVisibility, null);
  assert.equal(asGuest.body.photos[0].url, "/api/photos/" + photo);
  assert.equal(asGuest.body.coverPhoto.id, photo);
  assert.equal(asGuest.body.author.name, "owner " + nonce);
  const asOther = await reader.api.v1("/bikes/" + first);
  assert.equal(asOther.status, 200);
  assert.deepEqual(
    asOther.body,
    asGuest.body,
    "another user sees the guest's view",
  );
  const asOwner = await owner.api.v1("/bikes/" + first);
  assert.equal(asOwner.status, 200);
  assert.deepEqual(bikeSchema.parse(asOwner.body), asOwner.body);
  assertNoLeak("detail (owner)", asOwner.body);
  assert.equal(asOwner.body.isOwner, true);
  assert.equal(asOwner.body.price, 500000, "the owner sees their own price");
  assert.equal(asOwner.body.components[0].price, 1234.5);
  assert.deepEqual(asOwner.body.priceVisibility, {
    bike: false,
    components: false,
    accessories: false,
  });

  const ownPrivate = await owner.api.v1("/bikes/" + secret);
  assert.equal(ownPrivate.status, 200, ownPrivate.text);
  assert.equal(ownPrivate.body.isPublic, false);
  assert.equal(ownPrivate.body.price, 123456);
  for (const [who, response] of [
    ["guest", await guest.v1("/bikes/" + secret, { cookies: false })],
    ["reader", await reader.api.v1("/bikes/" + secret)],
  ])
    assertError(response, 404, "not_found", "private bike for " + who);
  const missing = await guest.v1("/bikes/" + randomUUID(), { cookies: false });
  assertError(missing, 404, "not_found", "missing bike");
  assert.equal(
    (await guest.v1("/bikes/" + secret, { cookies: false })).body.error.message,
    missing.body.error.message,
    "a private bike and a missing one answer alike",
  );
  for (const id of ["not-a-uuid", "123", "..%2F..%2Fme", first + "x"])
    assertError(
      await guest.v1("/bikes/" + id, { cookies: false }),
      404,
      "not_found",
      "id " + id,
    );
  for (const [who, request] of [
    ["guest", guest.v1("/bikes/" + barredBike, { cookies: false })],
    ["reader", reader.api.v1("/bikes/" + barredBike)],
    ["owner of it", barred.api.v1("/bikes/" + barredBike)],
  ])
    assertError(
      await request,
      404,
      "not_found",
      "a blocked owner's bike for " + who,
    );

  // ---- A blocked viewer holding a valid cookie is a guest.
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [reader.id]);
  assertError(
    await reader.api.v1("/me"),
    401,
    "unauthorized",
    "blocked viewer /me",
  );
  assertError(
    await reader.api.v1("/bikes?scope=mine"),
    401,
    "unauthorized",
    "blocked viewer mine",
  );
  assert.equal((await reader.api.v1("/bikes/" + first)).status, 200);
  assert.equal((await reader.api.v1("/bikes/" + secret)).status, 404);

  // ---- Methods and addresses.
  for (const path of ["/me", "/bikes", "/bikes/" + first, "/openapi.json"])
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await owner.api.v1(path, { method });
      assertError(response, 405, "method_not_allowed", `${method} ${path}`);
      assert.match(response.headers.get("allow"), /GET/);
    }
  for (const [path, method] of [
    ["/nope", "GET"],
    ["/nope", "POST"],
    ["/bikes/" + first + "/extra", "GET"],
    ["/me/extra", "GET"],
    ["", "GET"],
    ["/", "GET"],
  ])
    assertError(
      await guest.v1(path, { method, cookies: false }),
      404,
      "not_found",
      `${method} /api/v1${path}`,
    );

  // ---- Legacy stays as it was, on the same session.
  assert.deepEqual(
    (await guest("me")).body,
    { user: null },
    "legacy /me keeps its guest answer",
  );
  const legacyMe = await owner.api("me");
  assert.equal(legacyMe.status, 200);
  assert.equal(legacyMe.body.user.id, owner.id);
  const legacyList = await owner.api("bikes");
  assert.equal(legacyList.status, 200);
  assert.ok(legacyList.body.bikes.some((bike) => bike.id === secret));
  const legacyOne = await owner.api("bikes/" + first);
  assert.equal(
    legacyOne.body.bike.price,
    "500000.00",
    "the legacy DTO keeps its shape",
  );
  const shared = await guest("shared/" + legacyOne.body.bike.share_id);
  assert.equal(shared.status, 200);
  assert.equal(shared.body.bike.id, first);
  assert.equal(
    (
      await guest(
        "shared/" + (await owner.api("bikes/" + secret)).body.bike.share_id,
      )
    ).status,
    404,
  );
  const showcase = await guest("showcase");
  assert.equal(showcase.status, 200);
  assert.ok(showcase.body.bikes.some((bike) => bike.id === first));
  assert.ok(!showcase.body.bikes.some((bike) => bike.id === secret));

  // A session made by the legacy sign-in works in v1, and signing out ends it.
  const again = client();
  const login = await again("auth/login", "POST", {
    email: leaver.email,
    password: "api-v1-secret-123",
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const kept = again.cookie();
  assert.equal((await again.v1("/me")).body.id, leaver.id);
  assert.equal((await again("auth/logout", "POST")).status, 200);
  assertError(
    await guest.v1("/me", { cookies: false, headers: { cookie: kept } }),
    401,
    "unauthorized",
    "the session that signing out ended",
  );
  console.log(
    "API v1 HTTP: me, bikes and bike detail by viewer (guest, reader, owner, blocked), strict DTOs without row fields, prices by the owner's settings, keyset paging, typed errors, 405/404, OpenAPI served and complete, legacy API unchanged.",
  );
} finally {
  await db.end();
}
