// API v1, writing bicycles (#347, W2b), through the real server and PostgreSQL:
// create with a key and replay it, the owner's version (ETag/If-Match) on edits,
// the parts of the build, the order of their groups and the deletion that the
// site's rules refuse while rides remain. The rules are the site's; this checks
// that the transport keeps them, with a Bearer device session and a cookie.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import { planRow } from "./support/rides.ts";
import {
  bikeComponentRequestSchema,
  bikeRequestSchema,
  bikeSchema,
  componentSchema,
  errorSchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const run = randomUUID().slice(0, 8);
const password = "bikes-write-http-password-123";

async function http(
  path,
  { method = "GET", headers = {}, body, origin, raw } = {},
) {
  const response = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(origin === undefined ? {} : { origin }),
      ...(body === undefined || raw
        ? {}
        : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
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
  const email = `bikes-write-${label}-${run}@example.test`;
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
  const withCookie = (path, options = {}) =>
    http("/api/v1" + path, {
      origin: base,
      ...options,
      headers: { cookie, ...(options.headers ?? {}) },
    });
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
    cookie: withCookie,
    token: withToken,
  };
}
const guest = (path, options = {}) => http("/api/v1" + path, options);
function assertError(r, status, code, label) {
  assert.equal(r.status, status, label + " " + r.text);
  assert.deepEqual(errorSchema.parse(r.body), r.body, label);
  assert.equal(r.body.error.code, code, label);
}
const key = () => ({ "Idempotency-Key": randomUUID() });
const classification = (overrides = {}) => ({
  category: "mtb",
  subtype: "trail",
  suspension: null,
  construction: null,
  uses: [],
  electric: false,
  fatbike: false,
  ...overrides,
});
const bikeBody = (overrides = {}) => ({
  name: "Мой трейл",
  brand: "Cube",
  model: "Stereo",
  year: 2024,
  classification: classification(),
  isPublic: false,
  ...overrides,
});
const etagOf = (r) => r.headers.get("etag");

try {
  const owner = await member("owner");
  const other = await member("other");
  const mailless = await member("mailless", false);

  // ---- Who may write, and what a request has to be --------------------------
  assertError(
    await guest("/bikes", { method: "POST", body: bikeBody(), headers: key() }),
    401,
    "unauthorized",
    "guest create",
  );
  assertError(
    await owner.cookie("/bikes", {
      method: "POST",
      body: bikeBody(),
      headers: key(),
      origin: "https://evil.example",
    }),
    403,
    "forbidden",
    "a cookie from a foreign origin",
  );
  assertError(
    await owner.token("/bikes", { method: "POST", body: bikeBody() }),
    400,
    "invalid_request",
    "the key is required",
  );
  assertError(
    await owner.token("/bikes", {
      method: "POST",
      body: bikeBody(),
      headers: { "Idempotency-Key": "not-a-uuid" },
    }),
    400,
    "invalid_request",
    "a key that is no UUID",
  );
  assertError(
    await owner.token("/bikes", {
      method: "POST",
      body: "name=1",
      raw: true,
      headers: { ...key(), "Content-Type": "text/plain" },
    }),
    415,
    "unsupported_media_type",
    "not JSON",
  );
  assertError(
    await owner.token("/bikes", {
      method: "POST",
      body: bikeBody({ description: "я".repeat(2001) }),
      headers: key(),
    }),
    400,
    "invalid_request",
    "a description over the limit",
  );
  assertError(
    await owner.token("/bikes", {
      method: "POST",
      body: bikeBody({ description: "я".repeat(9000) }),
      headers: key(),
    }),
    413,
    "payload_too_large",
    "a body over the limit",
  );
  assertError(
    await owner.token("/bikes", {
      method: "POST",
      body: bikeBody({ category: "mtb" }),
      headers: key(),
    }),
    400,
    "invalid_request",
    "a field nobody listed",
  );
  const missingAudience = bikeBody();
  delete missingAudience.isPublic;
  const audience = await owner.token("/bikes", {
    method: "POST",
    body: missingAudience,
    headers: key(),
  });
  assertError(
    audience,
    400,
    "invalid_request",
    "the audience is never implied",
  );
  assert.ok(
    audience.body.error.details.some((d) => d.path === "isPublic"),
    "the error names the audience field",
  );
  assertError(
    await owner.token("/bikes", {
      method: "POST",
      body: bikeBody({ classification: classification({ subtype: "gravel" }) }),
      headers: key(),
    }),
    400,
    "invalid_request",
    "a subtype of another category",
  );

  // ---- Create, replay, conflict --------------------------------------------
  const request = bikeBody({
    description: "Для леса",
    color: "зелёный",
    size: "L",
    weight: 13.4,
    mileage: 120,
    purposes: [],
    price: 150000,
    priceVisibility: { bike: true, components: false, accessories: false },
  });
  assert.deepEqual(bikeRequestSchema.parse(request), request);
  const createKey = randomUUID();
  const created = await owner.token("/bikes", {
    method: "POST",
    body: request,
    headers: { "Idempotency-Key": createKey },
  });
  assert.equal(created.status, 201, created.text);
  const bike = bikeSchema.parse(created.body);
  assert.equal(bike.isOwner, true);
  assert.equal(bike.isPublic, false);
  assert.equal(bike.name, "Мой трейл");
  assert.equal(bike.classification.category, "mtb");
  assert.equal(bike.classification.subtype, "trail");
  assert.equal(bike.weight, 13.4);
  assert.equal(bike.price, 150000);
  assert.deepEqual(bike.priceVisibility, {
    bike: true,
    components: false,
    accessories: false,
  });
  assert.deepEqual(bike.components, []);
  assert.ok(etagOf(created), "a created bicycle carries its version");
  assert.equal(created.headers.get("cache-control"), "no-store");

  const replay = await owner.token("/bikes", {
    method: "POST",
    body: request,
    headers: { "Idempotency-Key": createKey },
  });
  assert.equal(replay.status, 201, replay.text);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.deepEqual(
    replay.body,
    created.body,
    "the same answer, not a second bike",
  );
  assert.equal(etagOf(replay), etagOf(created));
  assertError(
    await owner.token("/bikes", {
      method: "POST",
      body: { ...request, name: "Другое имя" },
      headers: { "Idempotency-Key": createKey },
    }),
    409,
    "conflict",
    "the same key with another body",
  );

  // Parallel retries of one creation make one bicycle.
  const parallelKey = randomUUID();
  const parallel = await Promise.all(
    Array.from({ length: 6 }, () =>
      owner.token("/bikes", {
        method: "POST",
        body: bikeBody({ name: "Параллельный" }),
        headers: { "Idempotency-Key": parallelKey },
      }),
    ),
  );
  for (const r of parallel) assert.equal(r.status, 201, r.text);
  assert.equal(new Set(parallel.map((r) => r.body.id)).size, 1);
  const mine = await owner.token("/bikes?scope=mine");
  assert.equal(
    mine.body.items.filter((item) => item.name === "Параллельный").length,
    1,
    "six identical requests, one bicycle",
  );

  // A cookie from the site works the same way as a device token.
  const viaCookie = await owner.cookie("/bikes", {
    method: "POST",
    body: bikeBody({ name: "С сайта" }),
    headers: key(),
  });
  assert.equal(viaCookie.status, 201, viaCookie.text);

  // ---- Publishing needs a confirmed address; a draft does not --------------
  const draftOnly = await mailless.token("/bikes", {
    method: "POST",
    body: bikeBody(),
    headers: key(),
  });
  assert.equal(draftOnly.status, 201, "a private bike is a draft anyone keeps");
  assertError(
    await mailless.token("/bikes", {
      method: "POST",
      body: bikeBody({ isPublic: true }),
      headers: key(),
    }),
    403,
    "email_verification_required",
    "publishing without a confirmed address",
  );
  assertError(
    await mailless.token(`/bikes/${draftOnly.body.id}`, {
      method: "PATCH",
      body: { isPublic: true },
      headers: { "If-Match": etagOf(draftOnly) },
    }),
    403,
    "email_verification_required",
    "publishing through an edit",
  );

  // ---- Reading: the version is the owner's alone ----------------------------
  const read = await owner.token(`/bikes/${bike.id}`);
  assert.equal(read.status, 200, read.text);
  assert.equal(
    etagOf(read),
    etagOf(created),
    "the read has the version that was made",
  );
  assert.equal(bikeSchema.parse(read.body).id, bike.id);
  assertError(
    await other.token(`/bikes/${bike.id}`),
    404,
    "not_found",
    "a private bike of another",
  );

  // ---- Edit: If-Match, partial bodies, stale versions ---------------------
  const path = `/bikes/${bike.id}`;
  assertError(
    await owner.token(path, { method: "PATCH", body: { name: "Новое" } }),
    428,
    "precondition_required",
    "an edit names the version it saw",
  );
  assertError(
    await owner.token(path, {
      method: "PATCH",
      body: { name: "Новое" },
      headers: { "If-Match": '"stale"' },
    }),
    412,
    "precondition_failed",
    "a version that is not the current one",
  );
  assertError(
    await other.token(path, {
      method: "PATCH",
      body: { name: "Чужое" },
      headers: { "If-Match": etagOf(read) },
    }),
    404,
    "not_found",
    "a bicycle of someone else",
  );
  assertError(
    await owner.token(path, {
      method: "PATCH",
      body: { colour: "x" },
      headers: { "If-Match": etagOf(read) },
    }),
    400,
    "invalid_request",
    "an unknown field",
  );
  const unchanged = await owner.token(path, {
    method: "PATCH",
    body: {},
    headers: { "If-Match": etagOf(read) },
  });
  assert.equal(unchanged.status, 200, unchanged.text);
  assert.equal(
    etagOf(unchanged),
    etagOf(read),
    "an empty edit changes nothing",
  );

  const edited = await owner.token(path, {
    method: "PATCH",
    body: {
      name: "Мой трейл 2",
      mileage: 250,
      weight: null,
      priceVisibility: { components: true },
      classification: classification({ subtype: "enduro", electric: true }),
    },
    headers: { "If-Match": etagOf(read) },
  });
  assert.equal(edited.status, 200, edited.text);
  const after = bikeSchema.parse(edited.body);
  assert.equal(after.name, "Мой трейл 2");
  assert.equal(after.mileage, 250);
  assert.equal(after.weight, null, "null clears the weight");
  assert.equal(after.brand, "Cube", "what the body does not name stays");
  assert.equal(after.price, 150000);
  assert.deepEqual(after.priceVisibility, {
    bike: true,
    components: true,
    accessories: false,
  });
  assert.equal(after.classification.subtype, "enduro");
  assert.equal(after.classification.electric, true);
  assert.notEqual(etagOf(edited), etagOf(read), "an edit gives a new version");
  assertError(
    await owner.token(path, {
      method: "PATCH",
      body: { name: "Со старой версией" },
      headers: { "If-Match": etagOf(read) },
    }),
    412,
    "precondition_failed",
    "the second device with the old version",
  );

  // Six devices edit the same version at once: one wins, the rest are told.
  const version = etagOf(edited);
  const race = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      owner.token(path, {
        method: "PATCH",
        body: { mileage: 1000 + index },
        headers: { "If-Match": version },
      }),
    ),
  );
  assert.equal(race.filter((r) => r.status === 200).length, 1, "one edit wins");
  assert.equal(
    race.filter((r) => r.status === 412).length,
    5,
    "the others read again, they do not overwrite",
  );

  // ---- Withdrawing a bicycle kills its old public link ---------------------
  const current = await owner.token(path);
  const published = await owner.token(path, {
    method: "PATCH",
    body: { isPublic: true },
    headers: { "If-Match": etagOf(current) },
  });
  assert.equal(published.status, 200, published.text);
  assert.equal(published.body.isPublic, true);
  assert.equal(
    (await other.token(path)).status,
    200,
    "published: others read it",
  );
  const shareBefore = (
    await db.query("SELECT share_id FROM bikes WHERE id=$1", [bike.id])
  ).rows[0].share_id;
  const withdrawn = await owner.token(path, {
    method: "PATCH",
    body: { isPublic: false },
    headers: { "If-Match": etagOf(published) },
  });
  assert.equal(withdrawn.status, 200, withdrawn.text);
  const shareAfter = (
    await db.query("SELECT share_id FROM bikes WHERE id=$1", [bike.id])
  ).rows[0].share_id;
  assert.notEqual(shareBefore, shareAfter, "the old public link stays dead");
  assertError(
    await other.token(path),
    404,
    "not_found",
    "withdrawn: hidden again",
  );

  // ---- The parts of the build ----------------------------------------------
  const parts = `${path}/components`;
  const part = {
    section: "build",
    category: "Вилка",
    name: "Fox 36",
    price: 90000,
  };
  assert.deepEqual(
    bikeComponentRequestSchema.parse(part),
    part,
    "a part needs only what identifies it",
  );
  assertError(
    await owner.token(parts, { method: "POST", body: part }),
    400,
    "invalid_request",
    "a part needs a key too",
  );
  assertError(
    await other.token(parts, { method: "POST", body: part, headers: key() }),
    404,
    "not_found",
    "a part on a bicycle of someone else",
  );
  assertError(
    await owner.token(parts, {
      method: "POST",
      body: { ...part, section: "wheels" },
      headers: key(),
    }),
    400,
    "invalid_request",
    "a section that does not exist",
  );
  const partKey = randomUUID();
  const addedPart = await owner.token(parts, {
    method: "POST",
    body: part,
    headers: { "Idempotency-Key": partKey },
  });
  assert.equal(addedPart.status, 201, addedPart.text);
  const fork = componentSchema.parse(addedPart.body);
  assert.equal(fork.name, "Fox 36");
  assert.equal(fork.price, 90000);
  assert.match(
    fork.modelId,
    /^[0-9a-f-]{36}$/,
    "the server links the catalog model",
  );
  assert.equal(fork.sortOrder, 0);
  assert.ok(etagOf(addedPart));
  const replayedPart = await owner.token(parts, {
    method: "POST",
    body: part,
    headers: { "Idempotency-Key": partKey },
  });
  assert.equal(replayedPart.status, 201);
  assert.equal(replayedPart.headers.get("idempotency-replayed"), "true");
  assert.equal(replayedPart.body.id, fork.id, "a repeat adds nothing");
  const second = await owner.token(parts, {
    method: "POST",
    body: { section: "accessories", category: "Фонарь", name: "Lezyne" },
    headers: key(),
  });
  assert.equal(second.status, 201, second.text);
  assert.equal(second.body.sortOrder, 1, "parts go to the end of the list");
  assert.equal(second.body.price, null);

  const listed = await owner.token(path);
  assert.deepEqual(
    listed.body.components.map((c) => c.name),
    ["Fox 36", "Lezyne"],
  );

  const partPath = `${parts}/${fork.id}`;
  const changedPart = await owner.token(partPath, {
    method: "PATCH",
    body: { name: "Fox 36 Factory", price: null },
    headers: { "If-Match": etagOf(addedPart) },
  });
  assert.equal(changedPart.status, 200, changedPart.text);
  assert.equal(changedPart.body.name, "Fox 36 Factory");
  assert.equal(changedPart.body.price, null);
  assert.equal(changedPart.body.category, "Вилка", "the rest stays");
  assert.notEqual(etagOf(changedPart), etagOf(addedPart));
  assertError(
    await owner.token(partPath, {
      method: "PATCH",
      body: { name: "Старая версия" },
      headers: { "If-Match": etagOf(addedPart) },
    }),
    412,
    "precondition_failed",
    "a part edited from an old version",
  );
  const blind = await owner.token(partPath, {
    method: "PATCH",
    body: { notes: "без версии" },
  });
  assert.equal(
    blind.status,
    200,
    "a client with no version may still edit a part",
  );
  assertError(
    await other.token(partPath, { method: "PATCH", body: { name: "Чужое" } }),
    404,
    "not_found",
    "a part of someone else's bicycle",
  );
  assertError(
    await owner.token(`${parts}/${randomUUID()}`, {
      method: "PATCH",
      body: { name: "Нет такого" },
    }),
    404,
    "not_found",
    "a part that does not exist",
  );
  assert.equal(
    (await owner.token(partPath, { method: "DELETE" })).status,
    204,
    "a part is removed",
  );
  assert.equal(
    (await owner.token(partPath, { method: "DELETE" })).status,
    204,
    "a repeat is 204 too",
  );
  assertError(
    await other.token(partPath, { method: "DELETE" }),
    404,
    "not_found",
    "removing from a bicycle of someone else",
  );
  assert.deepEqual(
    (await owner.token(path)).body.components.map((c) => c.name),
    ["Lezyne"],
  );

  // ---- The order of the groups ---------------------------------------------
  const order = `${path}/group-order`;
  const ordered = await owner.token(order, {
    method: "PUT",
    body: { groups: ["wheels", "drivetrain", "brakes"] },
  });
  assert.equal(ordered.status, 200, ordered.text);
  assert.deepEqual(bikeSchema.parse(ordered.body).groupOrder, [
    "wheels",
    "drivetrain",
    "brakes",
  ]);
  assertError(
    await owner.token(order, { method: "PUT", body: { groups: ["a", "a"] } }),
    400,
    "invalid_request",
    "a group twice",
  );
  assertError(
    await owner.token(order, { method: "PUT", body: { groups: ["Не ключ"] } }),
    400,
    "invalid_request",
    "a group that is no key",
  );
  assertError(
    await other.token(order, { method: "PUT", body: { groups: [] } }),
    404,
    "not_found",
    "the order of someone else's bicycle",
  );

  // ---- Deleting: rides keep a bicycle; a repeat is a plain 404 --------------
  const bikeId = bike.id;
  const rideId = (
    await planRow(db, owner.id, bikeId, new Date(Date.now() + 86400000))
  ).id;
  assertError(
    await other.token(path, { method: "DELETE" }),
    404,
    "not_found",
    "deleting someone else's bicycle",
  );
  assertError(
    await owner.token(path, { method: "DELETE" }),
    409,
    "conflict",
    "a bicycle with a ride stays",
  );
  assert.equal((await owner.token(path)).status, 200, "and is still there");
  await db.query("DELETE FROM rides WHERE id=$1", [rideId]);
  assert.equal((await owner.token(path, { method: "DELETE" })).status, 204);
  assertError(await owner.token(path), 404, "not_found", "gone");
  assertError(
    await owner.token(path, { method: "DELETE" }),
    404,
    "not_found",
    "a repeat after deletion",
  );

  // ---- The quota of bicycles is the site's --------------------------------
  const collector = await member("collector");
  const limit = Number(process.env.MAX_BIKES_PER_USER || 20);
  for (let n = 0; n < limit; n++)
    assert.equal(
      (
        await collector.token("/bikes", {
          method: "POST",
          body: bikeBody({ name: "Велосипед " + n }),
          headers: key(),
        })
      ).status,
      201,
    );
  assertError(
    await collector.token("/bikes", {
      method: "POST",
      body: bikeBody({ name: "Лишний" }),
      headers: key(),
    }),
    409,
    "conflict",
    "over the quota",
  );
  console.log(
    "API v1 bikes write HTTP: create with a key and replay, versions, parts, group order, deletion and quota passed.",
  );
} finally {
  await db.end();
}
