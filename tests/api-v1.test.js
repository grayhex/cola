import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  sessionHashOf,
  viewerFromCredential,
  viewerFromSessionHash,
} from "../lib/viewer-session.ts";
import {
  readSessionCookie,
  requestCredential,
} from "../lib/api-v1/credentials.ts";
import { decodeCursor, encodeCursor } from "../lib/api-v1/cursor.ts";
import { ApiError, apiErrorCodes, errorStatus } from "../lib/api-v1/errors.ts";
import { toBike, toBikeSummary, toMe } from "../lib/api-v1/mappers.ts";
import { buildOpenApiDocument } from "../lib/api-v1/openapi.ts";
import { errorResponse } from "../lib/api-v1/respond.ts";
import {
  LIST_LIMIT,
  bikePageSchema,
  bikeSchema,
  bikeSummarySchema,
  errorSchema,
  listQuerySchema,
  meSchema,
  parseListQuery,
} from "../lib/api-v1/schemas.ts";
import { insertBike } from "../lib/repository.ts";
import { getSite } from "../lib/site.ts";
import {
  visibleBike,
  visibleBikeById,
  visibleBikePage,
} from "../lib/showcase.ts";
import { bikeInput } from "../lib/validation.ts";

// API v1, first slice (#134): the viewer layer, the shared bike reads and the
// contract. The HTTP behaviour end to end is tests/api-v1-http.js.

const root = fileURLToPath(new URL("../", import.meta.url));
async function migrated() {
  const database = new PGlite();
  for (const file of (await readdir(path.join(root, "db")))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await database.exec(await readFile(path.join(root, "db", file), "utf8"));
  return database;
}
const db = await migrated();
after(() => db.close());
const site = await getSite(db);

// Fixtures bound to one database. Most tests share `db`; the paging test gets
// its own, so it can say exactly which bikes exist.
function harness(d) {
  async function addUser(name, { blocked = false } = {}) {
    const id = randomUUID();
    await d.query(
      "INSERT INTO users(id,email,name,password_hash,username,blocked,email_verified_at) VALUES($1,$2,$3,'hash',$4,$5,now())",
      [id, id + "@test.invalid", name, "u" + id.slice(0, 12), blocked],
    );
    return id;
  }
  async function addSession(
    userId,
    { lastSeenMinutesAgo = 0, expired = false } = {},
  ) {
    const token = randomBytes(32).toString("base64url");
    await d.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at,last_seen_at) VALUES($1,$2,now() + $3::interval,now() - $4::interval)",
      [
        sessionHashOf({ scheme: "cookie", token }),
        userId,
        expired ? "-1 hour" : "30 days",
        lastSeenMinutesAgo + " minutes",
      ],
    );
    return { scheme: "cookie", token };
  }
  async function addBike(owner, overrides = {}, createdAt = null) {
    const id = await insertBike(
      d,
      owner,
      bikeInput.parse({
        name: "Bike " + randomUUID().slice(0, 8),
        brand: "Cube",
        model: "Nuroad",
        year: 2024,
        category: "gravel",
        description: "",
        color: "",
        size: "",
        weight: null,
        is_public: true,
        ...overrides,
      }),
    );
    if (createdAt)
      await d.query("UPDATE bikes SET created_at=$1 WHERE id=$2", [
        createdAt,
        id,
      ]);
    return id;
  }
  return { addUser, addSession, addBike };
}
const { addUser, addSession, addBike } = harness(db);
const idsOf = (page) => page.bikes.map((bike) => bike.id);

test("viewer layer: a session digest names the viewer; unknown, expired and blocked sessions are guests", async () => {
  const person = await addUser("Viewer");
  const credential = await addSession(person);
  const viewer = await viewerFromCredential(db, credential);
  assert.equal(viewer?.id, person);
  // Only the columns CurrentUser names: never the password hash.
  assert.ok(!("password_hash" in viewer));
  assert.equal(await viewerFromCredential(db, null), null);
  assert.equal(
    await viewerFromCredential(db, { scheme: "cookie", token: "x".repeat(43) }),
    null,
  );
  assert.equal(
    await viewerFromCredential(db, await addSession(person, { expired: true })),
    null,
  );
  const blocked = await addUser("Blocked");
  const blockedCredential = await addSession(blocked);
  assert.equal(
    (await viewerFromCredential(db, blockedCredential))?.id,
    blocked,
  );
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [blocked]);
  assert.equal(await viewerFromCredential(db, blockedCredential), null);
  assert.equal(
    (await viewerFromSessionHash(db, sessionHashOf(credential)))?.id,
    person,
    "the browser adapter's entry point is the same rule",
  );
});

test("viewer layer: last use is refreshed at most every five minutes", async () => {
  const person = await addUser("Seen");
  const lastSeen = async (credential) =>
    (
      await db.query(
        "SELECT extract(epoch FROM last_seen_at) AS at FROM sessions WHERE token_hash=$1",
        [sessionHashOf(credential)],
      )
    ).rows[0].at;
  const recent = await addSession(person, { lastSeenMinutesAgo: 1 });
  const before = await lastSeen(recent);
  await viewerFromCredential(db, recent);
  assert.equal(
    await lastSeen(recent),
    before,
    "a mark under five minutes old stays",
  );
  const old = await addSession(person, { lastSeenMinutesAgo: 10 });
  const stale = await lastSeen(old);
  await viewerFromCredential(db, old);
  assert.ok((await lastSeen(old)) > stale + 500, "an old mark is refreshed");
});

test("credentials: a session cookie or a device Bearer token, never both, never a guess", () => {
  const token = randomBytes(32).toString("base64url");
  assert.equal(readSessionCookie(null), null);
  assert.equal(readSessionCookie("theme=dark"), null);
  assert.equal(readSessionCookie(`theme=dark; cola_session=${token}`), token);
  assert.equal(readSessionCookie(` cola_session=${token} ;a=b`), token);
  // The first cookie of the name wins, like the browser's jar; a malformed
  // value is not a session and does not fall back to a later one.
  assert.equal(
    readSessionCookie(`cola_session=short; cola_session=${token}`),
    null,
  );
  assert.equal(readSessionCookie("cola_session=" + "a".repeat(44)), null);
  assert.equal(readSessionCookie("xcola_session=" + token), null);
  assert.equal(requestCredential(new Headers()), null);
  assert.deepEqual(
    requestCredential(new Headers({ cookie: "cola_session=" + token })),
    { scheme: "cookie", token },
  );
  const refused = (headers, code, message) =>
    assert.throws(
      () => requestCredential(new Headers(headers)),
      (error) => error instanceof ApiError && error.code === code,
      message,
    );
  // Another scheme is never served as a guest or by cookie.
  for (const cookie of [undefined, "cola_session=" + token])
    refused(
      { authorization: "Basic Zm9vOmJhcg==", ...(cookie ? { cookie } : {}) },
      "unsupported_authentication",
      "a foreign Authorization scheme is unsupported",
    );
  refused({ authorization: "" }, "unsupported_authentication", "empty header");
  // Bearer (#303): the cookie and the header together are ambiguous, never
  // resolved silently, and a token of the wrong shape never becomes a guest.
  const access = "cola_at_" + randomBytes(32).toString("base64url");
  const refresh = "cola_rt_" + randomBytes(32).toString("base64url");
  assert.deepEqual(
    requestCredential(new Headers({ authorization: "Bearer " + access })),
    { scheme: "bearer", token: access },
  );
  assert.deepEqual(
    requestCredential(new Headers({ authorization: "bearer   " + access })),
    { scheme: "bearer", token: access },
    "the scheme name is case-insensitive",
  );
  for (const cookie of ["cola_session=" + token, "cola_session=short"])
    refused(
      { authorization: "Bearer " + access, cookie },
      "ambiguous_authentication",
      "cookie and Bearer together",
    );
  assert.deepEqual(
    requestCredential(
      new Headers({ authorization: "Bearer " + access, cookie: "theme=dark" }),
    ),
    { scheme: "bearer", token: access },
    "an unrelated cookie is not a session",
  );
  for (const bad of [
    "abc.def",
    token, // a browser session token
    refresh, // a refresh token is never an access token
    access + "x",
    access.slice(0, -1),
    "cola_at_" + "!".repeat(43),
  ])
    refused(
      { authorization: "Bearer " + bad },
      "invalid_token",
      "a token of the wrong shape is refused at once: " + bad.slice(0, 12),
    );
  refused(
    { authorization: "Bearer" },
    "unsupported_authentication",
    "no token",
  );
});

test("cursor: opaque, exact to the microsecond, and a forged one is a 400", () => {
  const cursor = {
    createdAt: "2026-10-01T10:00:00.000123Z",
    id: randomUUID(),
  };
  const encoded = encodeCursor(cursor);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeCursor(encoded), cursor);
  const forged = [
    "",
    "not a cursor",
    Buffer.from("{}").toString("base64url"),
    Buffer.from(JSON.stringify({ t: "yesterday", i: cursor.id })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({ t: cursor.createdAt, i: "1; DROP TABLE bikes" }),
    ).toString("base64url"),
    Buffer.from(
      JSON.stringify({ t: cursor.createdAt, i: cursor.id, extra: 1 }),
    ).toString("base64url"),
    // Millisecond precision would skip bikes created in the same millisecond.
    Buffer.from(
      JSON.stringify({ t: "2026-10-01T10:00:00.123Z", i: cursor.id }),
    ).toString("base64url"),
  ];
  for (const value of forged)
    assert.throws(
      () => decodeCursor(value),
      (error) => error instanceof ApiError && error.code === "invalid_request",
      value,
    );
});

test("list query: defaults, bounds, unknown and repeated parameters", () => {
  const parse = (query) =>
    parseListQuery(new URL("http://site.test/api/v1/bikes" + query));
  assert.deepEqual(parse(""), {
    scope: "public",
    category: "",
    q: "",
    limit: LIST_LIMIT.default,
  });
  assert.equal(parse("?limit=50").limit, 50);
  assert.equal(parse("?limit=1").limit, 1);
  assert.equal(parse("?scope=mine").scope, "mine");
  assert.equal(parse("?q=%20trek%20").q, "trek", "search is trimmed");
  assert.equal(parse("?category=mtb,road").category, "mtb,road");
  const invalid = [
    "?limit=0",
    "?limit=51",
    "?limit=-1",
    "?limit=abc",
    "?limit=1.5",
    "?limit=1e1",
    "?limit=",
    "?scope=all",
    "?category=nope",
    "?category=mtb,nope",
    "?q=" + "a".repeat(151),
    "?cursor=",
    "?cursor=" + "a".repeat(201),
    "?limt=5",
    "?page=2",
    "?limit=1&limit=2",
    "?scope=mine&scope=public",
  ];
  for (const query of invalid)
    assert.throws(
      () => parse(query),
      (error) =>
        error instanceof ApiError &&
        error.code === "invalid_request" &&
        error.details?.length > 0,
      query,
    );
  assert.equal(
    listQuerySchema.safeParse({ limit: "10", unknown: "1" }).success,
    false,
    "the schema is strict",
  );
});

test("visible bike by id: guests and others see public bikes; the owner also their private ones; blocked owners' bikes vanish", async () => {
  const owner = await addUser("Owner");
  const other = await addUser("Other");
  const blockedOwner = await addUser("Gone", { blocked: true });
  const publicBike = await addBike(owner);
  const privateBike = await addBike(owner, { is_public: false });
  const blockedBike = await addBike(blockedOwner);
  const view = (id, viewer) => visibleBikeById(db, id, viewer, site);
  for (const viewer of [null, other, owner]) {
    assert.equal((await view(publicBike, viewer))?.id, publicBike);
    assert.equal(await view(blockedBike, viewer), null);
    assert.equal(await view(randomUUID(), viewer), null);
  }
  assert.equal(await view(privateBike, null), null);
  assert.equal(await view(privateBike, other), null);
  assert.equal((await view(privateBike, owner))?.id, privateBike);
  assert.equal(
    await view(blockedBike, blockedOwner),
    null,
    "a blocked account reads nothing, its own bikes included",
  );
  // The share link keeps working through the same rule.
  const { share_id: share } = (
    await db.query("SELECT share_id FROM bikes WHERE id=$1", [publicBike])
  ).rows[0];
  assert.equal((await visibleBike(db, share, null, site))?.id, publicBike);
  assert.equal(
    (await visibleBike(db, share, other, site))?.id,
    (await view(publicBike, other))?.id,
  );
});

function keysDeep(value, found = new Set()) {
  if (Array.isArray(value)) for (const item of value) keysDeep(item, found);
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      keysDeep(child, found);
    }
  return found;
}
const hidden = [
  "owner_id",
  "share_id",
  "public_id",
  "slug",
  "factory_spec",
  "leaderboard_excluded",
  "published_at",
  "created_at",
  "updated_at",
  "password_hash",
  "token_hash",
  "user_agent",
  "preferences",
  "blocked",
  "email_verified_at",
  "avatar_id",
];

test("bike DTO: only the contract's fields, prices follow the owner's settings, nothing from a row", async () => {
  const owner = await addUser("Pricey");
  const reader = await addUser("Reader");
  const id = await addBike(owner, {
    price: 987654,
    show_bike_price: false,
    show_component_prices: false,
    weight: 9.8,
    mileage: 1200,
    purposes: ["city"],
  });
  const part = randomUUID(),
    photo = randomUUID();
  await db.query(
    "INSERT INTO components(id,bike_id,section,category,name,price) VALUES($1,$2,'build','Рама','Frame X',1234.5)",
    [part, id],
  );
  await db.query(
    "INSERT INTO photos(id,bike_id,filename,is_cover) VALUES($1,$2,$3,true)",
    [photo, id, "secret-file-name-" + photo + ".webp"],
  );
  const read = async (viewer) =>
    toBike(await visibleBikeById(db, id, viewer, site));

  const asReader = await read(reader);
  assert.deepEqual(bikeSchema.parse(asReader), asReader);
  assert.equal(asReader.isOwner, false);
  assert.equal(asReader.price, null, "a hidden price is null for others");
  assert.equal(asReader.components[0].price, null);
  assert.equal(asReader.priceVisibility, null);
  assert.equal(asReader.weight, 9.8, "numeric columns become numbers");
  assert.equal(asReader.mileage, 1200);
  assert.deepEqual(asReader.purposes, ["city"]);
  assert.equal(asReader.photos[0].url, "/api/photos/" + photo);
  assert.equal(asReader.coverPhoto.id, photo);
  assert.equal(asReader.photoCount, 1);
  assert.equal(asReader.author.name, "Pricey");
  assert.deepEqual(
    asReader,
    await read(null),
    "a guest sees what a reader sees, apart from reactions",
  );

  const asOwner = await read(owner);
  assert.deepEqual(bikeSchema.parse(asOwner), asOwner);
  assert.equal(asOwner.isOwner, true);
  assert.equal(asOwner.price, 987654, "the owner sees their own price");
  assert.equal(asOwner.components[0].price, 1234.5);
  assert.deepEqual(asOwner.priceVisibility, {
    bike: false,
    components: false,
    accessories: false,
  });

  await db.query(
    "UPDATE bikes SET show_bike_price=true,show_component_prices=true WHERE id=$1",
    [id],
  );
  const shown = await read(reader);
  assert.equal(shown.price, 987654);
  assert.equal(shown.components[0].price, 1234.5);

  // No raw column reaches a client: the contract is camelCase, so any
  // snake_case key would be a row or a legacy DTO leaking through.
  for (const dto of [asReader, asOwner, shown]) {
    const keys = keysDeep(dto);
    for (const key of keys) assert.doesNotMatch(key, /_/, key);
    for (const key of hidden) assert.ok(!keys.has(key), key);
    assert.doesNotMatch(JSON.stringify(dto), /secret-file-name/);
  }
  // A field outside the schema is refused: a leak would fail parsing.
  assert.equal(
    bikeSchema.safeParse({ ...asOwner, ownerId: owner }).success,
    false,
  );
});

test("me DTO: the explicit fields only", async () => {
  const person = await addUser("Self");
  const viewer = await viewerFromCredential(db, await addSession(person));
  const me = toMe(viewer);
  assert.deepEqual(meSchema.parse(me), me);
  assert.deepEqual(Object.keys(me).sort(), [
    "avatarUrl",
    "bio",
    "createdAt",
    "email",
    "emailVerifiedAt",
    "id",
    "location",
    "name",
    "role",
    "username",
  ]);
  assert.match(me.createdAt, /Z$/);
  assert.equal(me.role, "user");
  assert.ok(me.emailVerifiedAt);
  assert.equal(meSchema.safeParse({ ...me, preferences: {} }).success, false);
});

test("bike pages: scopes, filters and keyset paging that survives equal and microsecond-close timestamps", async () => {
  const pages = await migrated();
  after(() => pages.close());
  const { addUser, addBike } = harness(pages);
  const owner = await addUser("Pager");
  const stranger = await addUser("Stranger");
  const blockedOwner = await addUser("Barred", { blocked: true });
  const at = (clock) => "2026-08-01T" + clock + "Z";
  // Equal timestamps (the tie breaks by id) and values a microsecond apart
  // would collide if the cursor went through a JS Date.
  const mtb = await addBike(
    owner,
    { category: "mtb", name: "needle" },
    at("10:00:00.000001"),
  );
  const b2 = await addBike(owner, { category: "mtb" }, at("10:00:00.000002"));
  const b3 = await addBike(owner, {}, at("10:00:00.000003"));
  const b4 = await addBike(owner, {}, at("10:00:00.000003"));
  const b5 = await addBike(owner, {}, at("10:00:00.000004"));
  const b6 = await addBike(owner, {}, at("11:00:00.000000"));
  const secret = await addBike(
    owner,
    { is_public: false },
    at("12:00:00.000000"),
  );
  const barred = await addBike(blockedOwner, {}, at("12:30:00.000000"));
  const theirs = await addBike(stranger, {}, at("13:00:00.000000"));
  const common = { categories: [], search: "", limit: 2, after: null };

  const tied = [b3, b4].sort().reverse();
  const expected = [theirs, b6, b5, ...tied, b2, mtb];
  const walk = async (viewer, options) => {
    const seen = [];
    let after = null;
    for (let count = 0; count < 20; count++) {
      const page = await visibleBikePage(pages, viewer, { ...options, after });
      seen.push(...idsOf(page));
      if (!page.next) return { seen, pages: count + 1 };
      after = page.next;
    }
    throw new Error("the cursor never ended");
  };
  const everyone = await walk(null, { ...common, scope: "public" });
  assert.deepEqual(
    everyone.seen,
    expected,
    "each bike once, newest first, ties by id",
  );
  assert.equal(
    everyone.pages,
    4,
    "a last page of exactly `limit` ends the list without an empty page",
  );
  assert.ok(!everyone.seen.includes(secret) && !everyone.seen.includes(barred));

  // A bike published while someone is paging never shifts the next page.
  const first = await visibleBikePage(pages, null, {
    ...common,
    scope: "public",
  });
  assert.deepEqual(idsOf(first), [theirs, b6]);
  const late = await addBike(stranger, {}, at("14:00:00.000000"));
  const second = await visibleBikePage(pages, null, {
    ...common,
    scope: "public",
    after: first.next,
  });
  assert.deepEqual(
    idsOf(second),
    [b5, tied[0]],
    "no repeat, no skip, no newcomer",
  );
  assert.equal(
    idsOf(
      await visibleBikePage(pages, null, { ...common, scope: "public" }),
    )[0],
    late,
    "a fresh first page shows it",
  );

  assert.deepEqual(
    (await walk(null, { ...common, scope: "public", categories: ["mtb"] }))
      .seen,
    [b2, mtb],
  );
  assert.deepEqual(
    (await walk(null, { ...common, scope: "public", search: "NEEDLE" })).seen,
    [mtb],
    "search ignores case",
  );
  assert.deepEqual(
    (await walk(null, { ...common, scope: "public", search: "no such bike" }))
      .seen,
    [],
  );

  // «Mine»: the owner's own, private ones included; nobody else's.
  const mine = await walk(owner, { ...common, scope: "mine" });
  assert.deepEqual(
    mine.seen,
    [secret, b6, b5, ...tied, b2, mtb],
    "own private bike included",
  );
  assert.ok(!mine.seen.includes(theirs));
  assert.deepEqual((await walk(stranger, { ...common, scope: "mine" })).seen, [
    late,
    theirs,
  ]);
  assert.deepEqual(
    idsOf(await visibleBikePage(pages, null, { ...common, scope: "mine" })),
    [],
  );
  assert.deepEqual(
    idsOf(
      await visibleBikePage(pages, blockedOwner, { ...common, scope: "mine" }),
    ),
    [],
    "a blocked account's own list is empty",
  );

  // Cards are DTOs of the contract too.
  const page = await visibleBikePage(pages, owner, {
    ...common,
    scope: "mine",
    limit: 50,
  });
  const body = {
    items: page.bikes.map(toBikeSummary),
    nextCursor: page.next ? encodeCursor(page.next) : null,
  };
  assert.deepEqual(bikePageSchema.parse(body), body);
  for (const card of body.items) {
    assert.deepEqual(bikeSummarySchema.parse(card), card);
    assert.equal(card.isOwner, true);
    for (const key of keysDeep(card)) assert.doesNotMatch(key, /_/, key);
  }
  assert.equal(body.items.find((card) => card.id === secret).isPublic, false);
});

test("errors: the envelope is strict and every code has its documented status", () => {
  assert.deepEqual(Object.keys(errorStatus).sort(), [...apiErrorCodes].sort());
  for (const code of apiErrorCodes) {
    const response = errorResponse(
      new ApiError(code, "Сообщение", {
        details: [{ path: "limit", message: "bad" }],
        headers: { Allow: "GET" },
      }),
    );
    assert.equal(response.status, errorStatus[code]);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("allow"), "GET");
  }
  return errorResponse(new ApiError("not_found", "Нет"))
    .json()
    .then((body) => {
      assert.deepEqual(errorSchema.parse(body), body);
      assert.deepEqual(body, { error: { code: "not_found", message: "Нет" } });
    });
});

function operationsOf(document) {
  return Object.entries(document.paths)
    .flatMap(([route, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${route}`),
    )
    .sort();
}
async function routeFiles(directory, prefix = "") {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory())
      found.push(
        ...(await routeFiles(
          path.join(directory, entry.name),
          prefix + "/" + entry.name,
        )),
      );
    else if (entry.name === "route.ts")
      found.push({
        route: prefix || "/",
        source: await readFile(path.join(directory, entry.name), "utf8"),
      });
  }
  return found;
}
function walkRefs(value, refs = new Set()) {
  if (Array.isArray(value)) for (const item of value) walkRefs(item, refs);
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value))
      if (key === "$ref") refs.add(child);
      else walkRefs(child, refs);
  return refs;
}

test("OpenAPI: documents exactly the implemented operations, every $ref resolves, parameters match the parser", async () => {
  const document = buildOpenApiDocument("https://cola.example");
  assert.equal(document.openapi, "3.1.0");
  assert.deepEqual(document.servers, [{ url: "https://cola.example/api/v1" }]);

  // The operations of the document are the handled methods of the route files
  // under app/api/v1: nothing documented that does not exist, nothing
  // implemented undocumented. A method that is only methodNotAllowed is not one.
  const files = await routeFiles(path.join(root, "app/api/v1"));
  const implemented = files
    .filter(({ route }) => !route.includes("..."))
    .flatMap(({ route, source }) =>
      [
        ...source.matchAll(
          /export const (GET|POST|PUT|PATCH|DELETE)\s*=\s*traced\(\s*(\w+)/g,
        ),
      ]
        .filter(([, , handler]) => handler !== "methodNotAllowed")
        .map(
          ([, method]) => method + " " + route.replace(/\[(\w+)\]/g, "{$1}"),
        ),
    )
    .sort();
  assert.deepEqual(operationsOf(document), implemented);
  assert.ok(
    files.some(({ route }) => route.includes("[[...path]]")),
    "unknown addresses under /api/v1 get the API's own 404",
  );

  const ids = Object.values(document.paths).flatMap((methods) =>
    Object.values(methods).map((operation) => operation.operationId),
  );
  assert.equal(new Set(ids).size, ids.length, "operationIds are unique");

  for (const reference of walkRefs(document)) {
    assert.match(reference, /^#\//);
    let target = document;
    for (const part of reference.slice(2).split("/")) target = target?.[part];
    assert.ok(target, "unresolved " + reference);
  }
  assert.deepEqual(
    Object.keys(document.components.schemas).sort(),
    [
      "AccountSession",
      "Author",
      "Bike",
      "BikeClassification",
      "BikeComponent",
      "BikeLike",
      "BikePage",
      "BikePhoto",
      "BikePriceVisibility",
      "BikeRef",
      "BikeScores",
      "BikeSummary",
      "Comment",
      "CommentPage",
      "CommentThread",
      "ComponentFilters",
      "ComponentHit",
      "ComponentHitList",
      "ComponentModel",
      "ComponentModelPage",
      "ComponentPhoto",
      "ComponentPhotoList",
      "ComponentPhotoSource",
      "CreateSessionRequest",
      "DeviceInput",
      "EntryPhoto",
      "Error",
      "ErrorBody",
      "ErrorCode",
      "ErrorDetail",
      "FollowResult",
      "JournalComponent",
      "JournalEntry",
      "JournalPage",
      "JournalSummary",
      "MarketBikeLink",
      "MarketCatalogLink",
      "MarketContact",
      "MarketListing",
      "MarketListingDetail",
      "MarketOthers",
      "MarketPage",
      "MarketSaved",
      "Me",
      "Profile",
      "ProfileCounts",
      "RefreshRequest",
      "Relationship",
      "ReplyPage",
      "Ride",
      "RideAnalysis",
      "RideAnalysisPoint",
      "RideArea",
      "RideGeometry",
      "RideMetrics",
      "RidePage",
      "RideParticipants",
      "RidePassport",
      "RideRange",
      "RideSummary",
      "SaveResult",
      "SessionGrant",
      "SessionList",
      "UserPage",
      "UserSummary",
    ],
    "a new public schema is a visible, deliberate change",
  );
  // Contract hygiene (#300): the schemas of an error are named (no ErrorError),
  // and the code is an open string; the known set lives in ErrorCode.
  assert.deepEqual(document.components.schemas.ErrorCode.enum, [
    ...apiErrorCodes,
  ]);
  assert.equal(
    document.components.schemas.ErrorBody.properties.code.type,
    "string",
    "a new error code must not break a generated client",
  );
  assert.equal(
    document.components.schemas.ErrorBody.properties.code.enum,
    undefined,
  );
  assert.equal(
    document.components.schemas.Error.properties.error.$ref,
    "#/components/schemas/ErrorBody",
  );
  assert.doesNotMatch(
    JSON.stringify(document),
    /ErrorError|InnerInner|DetailsInner/,
    "no generator-made names",
  );
  assert.deepEqual(document.info.license, {
    name: "Пользовательское соглашение ColaBike",
    url: "https://cola.example/legal/terms",
  });
  for (const [route, methods] of Object.entries(document.paths))
    for (const operation of Object.values(methods))
      for (const [status, response] of Object.entries(operation.responses))
        if (response.$ref)
          assert.ok(
            document.components.responses[response.$ref.split("/").pop()],
            route + " " + status,
          );

  const list = document.paths["/bikes"].get;
  const documented = list.parameters.map((ref) =>
    ref.$ref.replace("#/components/parameters/", ""),
  );
  const parameters = documented.map(
    (name) => document.components.parameters[name],
  );
  assert.deepEqual(
    parameters.map((parameter) => parameter.name).sort(),
    Object.keys(listQuerySchema.shape).sort(),
    "the documented query parameters are the parser's",
  );
  const limit = parameters.find((parameter) => parameter.name === "limit");
  assert.deepEqual(limit.schema, {
    type: "integer",
    minimum: LIST_LIMIT.min,
    maximum: LIST_LIMIT.max,
    default: LIST_LIMIT.default,
  });
  assert.equal(
    parseListQuery(new URL("http://x.test/?limit=" + LIST_LIMIT.max)).limit,
    LIST_LIMIT.max,
  );
  assert.throws(() =>
    parseListQuery(new URL("http://x.test/?limit=" + (LIST_LIMIT.max + 1))),
  );

  // Nothing leaks into the document's text either.
  const text = JSON.stringify(document);
  assert.doesNotMatch(text, /"\$id"|"\$schema"|9007199254740991/);
  assert.equal(document.components.securitySchemes.cookieSession.in, "cookie");
  assert.deepEqual(
    {
      type: document.components.securitySchemes.bearerAuth.type,
      scheme: document.components.securitySchemes.bearerAuth.scheme,
    },
    { type: "http", scheme: "bearer" },
    "device sessions advertise Bearer (#303)",
  );
});
