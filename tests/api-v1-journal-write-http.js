// API v1, writing the journal (#347, W3), through the real server and
// PostgreSQL: an entry of one's own bicycle (draft and publication, a key that
// makes a creation safe to repeat, the version of an edit) and its photos. The
// rules are the site's; this checks that the transport keeps them, with a
// Bearer device session and a cookie.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import sharp from "sharp";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import {
  entryPhotoSchema,
  errorSchema,
  journalEntrySchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const run = randomUUID().slice(0, 8);
const password = "journal-write-http-password-123";

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
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString("utf8");
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    status: response.status,
    body: json,
    text,
    bytes,
    headers: response.headers,
  };
}
async function member(label, verified = true) {
  const email = `journal-write-${label}-${run}@example.test`;
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
  const grant = await http("/api/v1/auth/sessions", {
    method: "POST",
    body: {
      email,
      password,
      device: { name: "Телефон " + label, platform: "ios" },
    },
  });
  assert.equal(grant.status, 201, grant.text);
  const token = (path, options = {}) =>
    http("/api/v1" + path, {
      ...options,
      headers: {
        authorization: "Bearer " + grant.body.accessToken,
        ...(options.headers ?? {}),
      },
    });
  const withCookie = (path, options = {}) =>
    http("/api/v1" + path, {
      origin: base,
      ...options,
      headers: { cookie, ...(options.headers ?? {}) },
    });
  return {
    id: registered.body.user.id,
    bearer: "Bearer " + grant.body.accessToken,
    token,
    cookie: withCookie,
  };
}
function assertError(r, status, code, label) {
  assert.equal(r.status, status, label + " " + r.text);
  assert.deepEqual(errorSchema.parse(r.body), r.body, label);
  assert.equal(r.body.error.code, code, label);
}
const key = () => ({ "Idempotency-Key": randomUUID() });
const etagOf = (r) => r.headers.get("etag");
const classification = {
  category: "mtb",
  subtype: "trail",
  suspension: null,
  construction: null,
  uses: [],
  electric: false,
  fatbike: false,
};
async function newBike(who, isPublic) {
  const r = await who.token("/bikes", {
    method: "POST",
    body: {
      name: "Журнальный байк",
      brand: "Cube",
      model: "Stereo",
      year: 2024,
      classification,
      isPublic,
    },
    headers: key(),
  });
  assert.equal(r.status, 201, r.text);
  return r.body.id;
}
async function newPart(who, bike, name, category = "Вилка") {
  const r = await who.token(`/bikes/${bike}/components`, {
    method: "POST",
    body: { section: "build", category, name },
    headers: key(),
  });
  assert.equal(r.status, 201, r.text);
  return r.body.id;
}
const entryBody = (bikeId, overrides = {}) => ({
  bikeId,
  kind: "service",
  title: "Замена цепи",
  body: "Поменял цепь и кассету, проехал 50 км без проблем.",
  status: "draft",
  isPublic: false,
  ...overrides,
});
const photoBytes = (width = 320, height = 240, color = "#446688") =>
  sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
const upload = (who, entry, bytes, headers = key()) =>
  who.token(`/journal/${entry}/photos`, {
    method: "POST",
    body: bytes,
    raw: true,
    headers: { "Content-Type": "image/jpeg", ...headers },
  });

try {
  const owner = await member("owner");
  const other = await member("other");
  const mailless = await member("mailless", false);
  const publicBike = await newBike(owner, true);
  const privateBike = await newBike(owner, false);
  const draftBike = await newBike(mailless, false);
  const fork = await newPart(owner, publicBike, "Fox 36");
  const wheels = await newPart(owner, publicBike, "DT Swiss", "Колёса");

  // ---- Who may write, and what a request has to be --------------------------
  const guest = (path, options = {}) => http("/api/v1" + path, options);
  assertError(
    await guest("/journal", {
      method: "POST",
      body: entryBody(publicBike),
      headers: key(),
    }),
    401,
    "unauthorized",
    "guest create",
  );
  assertError(
    await owner.cookie("/journal", {
      method: "POST",
      body: entryBody(publicBike),
      headers: key(),
      origin: "https://evil.example",
    }),
    403,
    "forbidden",
    "a cookie from a foreign origin",
  );
  assertError(
    await owner.token("/journal", {
      method: "POST",
      body: entryBody(publicBike),
    }),
    400,
    "invalid_request",
    "the key is required",
  );
  const unnamed = entryBody(publicBike);
  delete unnamed.isPublic;
  assertError(
    await owner.token("/journal", {
      method: "POST",
      body: unnamed,
      headers: key(),
    }),
    400,
    "invalid_request",
    "the audience is never implied",
  );
  assertError(
    await owner.token("/journal", {
      method: "POST",
      body: entryBody(publicBike, { solutionId: randomUUID() }),
      headers: key(),
    }),
    400,
    "invalid_request",
    "a field nobody listed",
  );
  assertError(
    await owner.token("/journal", {
      method: "POST",
      body: entryBody(publicBike, { status: "published", title: "", body: "" }),
      headers: key(),
    }),
    400,
    "invalid_request",
    "a publication needs a title and a text",
  );
  assertError(
    await owner.token("/journal", {
      method: "POST",
      body: entryBody(randomUUID()),
      headers: key(),
    }),
    404,
    "not_found",
    "a bicycle that is not mine",
  );
  assertError(
    await other.token("/journal", {
      method: "POST",
      body: entryBody(publicBike),
      headers: key(),
    }),
    404,
    "not_found",
    "a bicycle of someone else",
  );
  assertError(
    await owner.token("/journal", {
      method: "POST",
      body: entryBody(publicBike, { componentIds: [randomUUID()] }),
      headers: key(),
    }),
    400,
    "invalid_request",
    "a part that is not on this bicycle",
  );

  // ---- A draft, its replay and its conflict --------------------------------
  const request = entryBody(publicBike, {
    eventDate: "2026-09-20",
    mileage: 4200,
    componentIds: [fork, wheels],
  });
  const createKey = randomUUID();
  const created = await owner.token("/journal", {
    method: "POST",
    body: request,
    headers: { "Idempotency-Key": createKey },
  });
  assert.equal(created.status, 201, created.text);
  const entry = journalEntrySchema.parse(created.body);
  assert.equal(entry.status, "draft");
  assert.equal(entry.isPublic, false);
  assert.equal(entry.kind, "service");
  assert.equal(entry.eventDate, "2026-09-20");
  assert.equal(entry.mileage, 4200);
  assert.equal(entry.rideId, null);
  assert.equal(entry.installationResult, null);
  assert.deepEqual(
    entry.components.map((part) => part.id).sort(),
    [fork, wheels].sort(),
  );
  assert.ok(entry.components.every((part) => part.capturedAt));
  assert.deepEqual(entry.photos, []);
  assert.equal(entry.bike.id, publicBike);
  assert.ok(etagOf(created), "a created entry carries its version");
  assert.equal(created.headers.get("cache-control"), "no-store");

  const replay = await owner.token("/journal", {
    method: "POST",
    body: request,
    headers: { "Idempotency-Key": createKey },
  });
  assert.equal(replay.status, 201, replay.text);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.deepEqual(replay.body, created.body, "the same entry, not a second");
  assertError(
    await owner.token("/journal", {
      method: "POST",
      body: { ...request, title: "Другой заголовок" },
      headers: { "Idempotency-Key": createKey },
    }),
    409,
    "conflict",
    "the same key with another body",
  );
  const parallelKey = randomUUID();
  const parallel = await Promise.all(
    Array.from({ length: 6 }, () =>
      owner.token("/journal", {
        method: "POST",
        body: entryBody(privateBike, { title: "Параллельная" }),
        headers: { "Idempotency-Key": parallelKey },
      }),
    ),
  );
  for (const r of parallel) assert.equal(r.status, 201, r.text);
  assert.equal(new Set(parallel.map((r) => r.body.id)).size, 1);
  const own = await owner.token(`/bikes/${privateBike}/journal`);
  assert.equal(
    own.body.items.filter((item) => item.title === "Параллельная").length,
    1,
    "six identical requests, one entry",
  );

  // ---- A draft is the owner's alone ---------------------------------------
  const read = await owner.token(`/journal/${entry.id}`);
  assert.equal(read.status, 200, read.text);
  assert.equal(
    etagOf(read),
    etagOf(created),
    "the read has the version that was made",
  );
  assertError(
    await other.token(`/journal/${entry.id}`),
    404,
    "not_found",
    "a draft of another",
  );
  assert.equal(
    (await other.token(`/journal/${entry.id}`)).headers.get("etag"),
    null,
    "no version for a reader who may not write",
  );
  assert.ok(
    !(await other.token(`/bikes/${publicBike}/journal`)).body.items.some(
      (item) => item.id === entry.id,
    ),
    "a draft is not in the list of others",
  );

  // ---- Publishing: a confirmed address, a title and a text ---------------
  assert.equal(
    (
      await mailless.token("/journal", {
        method: "POST",
        body: entryBody(draftBike),
        headers: key(),
      })
    ).status,
    201,
    "a draft needs no confirmed address",
  );
  assertError(
    await mailless.token("/journal", {
      method: "POST",
      body: entryBody(draftBike, { status: "published", isPublic: true }),
      headers: key(),
    }),
    403,
    "email_verification_required",
    "publishing for everyone without a confirmed address",
  );
  const quiet = await mailless.token("/journal", {
    method: "POST",
    body: entryBody(draftBike, { status: "published", isPublic: false }),
    headers: key(),
  });
  assert.equal(quiet.status, 201, "published but not public needs none");

  // ---- Editing: If-Match, partial bodies, stale versions ------------------
  const path = `/journal/${entry.id}`;
  assertError(
    await owner.token(path, { method: "PATCH", body: { title: "Новый" } }),
    428,
    "precondition_required",
    "an edit names the version it saw",
  );
  assertError(
    await owner.token(path, {
      method: "PATCH",
      body: { title: "Новый" },
      headers: { "If-Match": '"stale"' },
    }),
    412,
    "precondition_failed",
    "a version that is not the current one",
  );
  assertError(
    await other.token(path, {
      method: "PATCH",
      body: { title: "Чужое" },
      headers: { "If-Match": etagOf(read) },
    }),
    404,
    "not_found",
    "an entry of someone else",
  );
  assertError(
    await owner.token(path, {
      method: "PATCH",
      body: { bikeId: privateBike },
      headers: { "If-Match": etagOf(read) },
    }),
    400,
    "invalid_request",
    "the bicycle cannot be changed",
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
    body: { title: "Замена цепи и кассеты", eventDate: null, mileage: 4300 },
    headers: { "If-Match": etagOf(read) },
  });
  assert.equal(edited.status, 200, edited.text);
  const after = journalEntrySchema.parse(edited.body);
  assert.equal(after.title, "Замена цепи и кассеты");
  assert.equal(after.eventDate, null, "null clears the date");
  assert.equal(after.mileage, 4300);
  assert.equal(after.body, entry.body, "what the body does not name stays");
  assert.equal(after.kind, "service");
  assert.equal(after.components.length, 2, "the snapshot of the parts stays");
  assert.notEqual(etagOf(edited), etagOf(read), "an edit gives a new version");
  assertError(
    await owner.token(path, {
      method: "PATCH",
      body: { title: "Со старой версией" },
      headers: { "If-Match": etagOf(read) },
    }),
    412,
    "precondition_failed",
    "the second device with the old version",
  );

  // Six devices edit the same version at once: one wins, the rest are told.
  const race = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      owner.token(path, {
        method: "PATCH",
        body: { mileage: 5000 + index },
        headers: { "If-Match": etagOf(edited) },
      }),
    ),
  );
  assert.equal(race.filter((r) => r.status === 200).length, 1, "one edit wins");
  assert.equal(
    race.filter((r) => r.status === 412).length,
    5,
    "the others read again, they do not overwrite",
  );

  // A part renamed after the snapshot keeps its old name in the entry; the
  // list of parts is replaced as a whole.
  await owner.token(`/bikes/${publicBike}/components/${fork}`, {
    method: "PATCH",
    body: { name: "Fox 38" },
  });
  const afterRename = await owner.token(path);
  assert.equal(
    afterRename.body.components.find((part) => part.id === fork).name,
    "Fox 36",
    "a retained part keeps its snapshot",
  );
  const narrowed = await owner.token(path, {
    method: "PATCH",
    body: { componentIds: [fork] },
    headers: { "If-Match": etagOf(afterRename) },
  });
  assert.equal(narrowed.status, 200, narrowed.text);
  assert.deepEqual(
    narrowed.body.components.map((part) => part.id),
    [fork],
  );

  // The kind decides whether the installation result means anything.
  const building = await owner.token(path, {
    method: "PATCH",
    body: { kind: "build", installationResult: "modified" },
    headers: { "If-Match": etagOf(narrowed) },
  });
  assert.equal(building.status, 200, building.text);
  assert.equal(building.body.installationResult, "modified");
  const service = await owner.token(path, {
    method: "PATCH",
    body: { kind: "service" },
    headers: { "If-Match": etagOf(building) },
  });
  assert.equal(service.body.installationResult, null, "reset for other kinds");

  // ---- Publish for everyone, and withdraw ---------------------------------
  const published = await owner.token(path, {
    method: "PATCH",
    body: { status: "published", isPublic: true },
    headers: { "If-Match": etagOf(service) },
  });
  assert.equal(published.status, 200, published.text);
  assert.equal(published.body.status, "published");
  const seen = await other.token(path);
  assert.equal(seen.status, 200, "published: others read it");
  assert.equal(seen.body.rideId, null);
  assert.ok(
    (await other.token(`/bikes/${publicBike}/journal`)).body.items.some(
      (item) => item.id === entry.id,
    ),
    "and find it in the list of the bicycle",
  );
  const withdrawn = await owner.token(path, {
    method: "PATCH",
    body: { status: "draft" },
    headers: { "If-Match": etagOf(published) },
  });
  assert.equal(withdrawn.status, 200, withdrawn.text);
  assertError(
    await other.token(path),
    404,
    "not_found",
    "withdrawn: hidden again",
  );

  // ---- Photos ---------------------------------------------------------------
  const photos = `/journal/${entry.id}/photos`;
  const bytes = await photoBytes();
  assertError(
    await upload(owner, entry.id, bytes, {}),
    400,
    "invalid_request",
    "a photo needs a key too",
  );
  assertError(
    await upload(other, entry.id, bytes),
    404,
    "not_found",
    "a photo for an entry of someone else",
  );
  assertError(
    await owner.token(photos, {
      method: "POST",
      body: bytes,
      raw: true,
      headers: { "Content-Type": "text/plain", ...key() },
    }),
    415,
    "unsupported_media_type",
    "a declared type that is no image",
  );
  const photoKey = randomUUID();
  const first = await upload(owner, entry.id, bytes, {
    "Idempotency-Key": photoKey,
  });
  assert.equal(first.status, 201, first.text);
  const photo = entryPhotoSchema.parse(first.body);
  assert.equal(photo.url, `/api/journal/media/${photo.id}`);
  const replayedPhoto = await upload(owner, entry.id, bytes, {
    "Idempotency-Key": photoKey,
  });
  assert.equal(replayedPhoto.headers.get("idempotency-replayed"), "true");
  assert.equal(
    replayedPhoto.body.id,
    photo.id,
    "a repeat adds no second photo",
  );
  assertError(
    await upload(owner, entry.id, await photoBytes(400, 300, "#aa6644"), {
      "Idempotency-Key": photoKey,
    }),
    409,
    "conflict",
    "the same key with another file",
  );
  const withPhoto = await owner.token(path);
  assert.deepEqual(withPhoto.body.photos, [photo]);
  const served = await http(photo.url, {
    headers: { authorization: owner.bearer },
  });
  assert.equal(served.status, 200, "the owner reads the photo of a draft");
  assert.equal((await http(photo.url)).status, 404, "a guest does not");
  assert.equal(
    (await http(photo.url, { headers: { authorization: other.bearer } }))
      .status,
    404,
    "nor another person",
  );
  assert.equal(
    (await owner.token(`${photos}/${photo.id}`, { method: "DELETE" })).status,
    204,
    "a photo is removed",
  );
  assert.equal(
    (await owner.token(`${photos}/${photo.id}`, { method: "DELETE" })).status,
    204,
    "a repeat is 204 too",
  );
  assertError(
    await other.token(`${photos}/${photo.id}`, { method: "DELETE" }),
    404,
    "not_found",
    "removing from an entry of someone else",
  );
  assert.deepEqual((await owner.token(path)).body.photos, []);
  for (let n = 0; n < 8; n++) {
    const r = await upload(owner, entry.id, await photoBytes(320 + n, 240));
    assert.equal(r.status, 201, `photo ${n}: ${r.text}`);
  }
  assertError(
    await upload(owner, entry.id, await photoBytes(500, 400)),
    409,
    "conflict",
    "the 9th photo of one entry",
  );

  // ---- Deleting an entry takes its photos and their files with it ----------
  // (Another person: the budget of entries is the site's, 20 per window.)
  const closer = await member("closer");
  const closerBike = await newBike(closer, false);
  const doomed = await closer.token("/journal", {
    method: "POST",
    body: entryBody(closerBike, { title: "На удаление" }),
    headers: key(),
  });
  assert.equal(doomed.status, 201, doomed.text);
  const doomedPhoto = await upload(closer, doomed.body.id, bytes);
  assert.equal(doomedPhoto.status, 201, doomedPhoto.text);
  const fileName = (
    await db.query("SELECT filename FROM journal_photos WHERE id=$1", [
      doomedPhoto.body.id,
    ])
  ).rows[0].filename;
  assert.ok(existsSync(join(process.env.UPLOAD_DIR, fileName)));
  assertError(
    await other.token(`/journal/${doomed.body.id}`, { method: "DELETE" }),
    404,
    "not_found",
    "deleting an entry of someone else",
  );
  assert.equal(
    (await closer.token(`/journal/${doomed.body.id}`, { method: "DELETE" }))
      .status,
    204,
  );
  assertError(
    await closer.token(`/journal/${doomed.body.id}`),
    404,
    "not_found",
    "gone",
  );
  assertError(
    await closer.token(`/journal/${doomed.body.id}`, { method: "DELETE" }),
    404,
    "not_found",
    "a repeat after deletion",
  );
  assert.ok(
    !existsSync(join(process.env.UPLOAD_DIR, fileName)),
    "the file goes with the entry",
  );
  console.log(
    "API v1 journal write HTTP: draft and publication, key and replay, versions, snapshots, photos and deletion passed.",
  );
} finally {
  await db.end();
}
