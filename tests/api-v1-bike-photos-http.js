// API v1, photos of a bicycle (#347, W6a), through the real server and
// PostgreSQL: a raw upload with a key that stands for the file, the cover, the
// deletion that hands the cover on, and the limits of the site. Files are real
// images made here, because the server looks at bytes and not at headers.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import { bikeSchema, errorSchema, photoSchema } from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const run = randomUUID().slice(0, 8);
const password = "bike-photos-http-password-123";

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
  const email = `bike-photos-${label}-${run}@example.test`;
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
const image = (width, height, color, format = "jpeg") => {
  const source = sharp({
    create: { width, height, channels: 3, background: color },
  });
  return source[format]().toBuffer();
};
const upload = (who, bike, bytes, type = "image/jpeg", headers = key()) =>
  who.token(`/bikes/${bike}/photos`, {
    method: "POST",
    body: bytes,
    raw: true,
    headers: { "Content-Type": type, ...headers },
  });
const bikeBody = (overrides = {}) => ({
  name: "Фото-байк",
  brand: "Cube",
  model: "Stereo",
  year: 2024,
  classification: {
    category: "mtb",
    subtype: "trail",
    suspension: null,
    construction: null,
    uses: [],
    electric: false,
    fatbike: false,
  },
  isPublic: false,
  ...overrides,
});
async function newBike(who, overrides) {
  const r = await who.token("/bikes", {
    method: "POST",
    body: bikeBody(overrides),
    headers: key(),
  });
  assert.equal(r.status, 201, r.text);
  return r.body.id;
}
const uploads = () => process.env.UPLOAD_DIR;

try {
  const owner = await member("owner");
  const other = await member("other");
  const mailless = await member("mailless", false);
  const bike = await newBike(owner);
  const jpeg = await image(1200, 800, "#5b8a72");
  const png = await image(900, 700, "#a0522d", "png");
  const webp = await image(800, 600, "#3366aa", "webp");

  // ---- Who may upload, and what a request has to be ------------------------
  assertError(
    await http(`/api/v1/bikes/${bike}/photos`, {
      method: "POST",
      body: jpeg,
      raw: true,
      headers: { "Content-Type": "image/jpeg", ...key() },
    }),
    401,
    "unauthorized",
    "guest upload",
  );
  assertError(
    await owner.cookie(`/bikes/${bike}/photos`, {
      method: "POST",
      body: jpeg,
      raw: true,
      origin: "https://evil.example",
      headers: { "Content-Type": "image/jpeg", ...key() },
    }),
    403,
    "forbidden",
    "a cookie from a foreign origin",
  );
  assertError(
    await upload(owner, bike, jpeg, "image/jpeg", {}),
    400,
    "invalid_request",
    "the key is required",
  );
  assertError(
    await upload(owner, bike, jpeg, "image/jpeg", {
      "Idempotency-Key": "nope",
    }),
    400,
    "invalid_request",
    "a key that is no UUID",
  );
  assertError(
    await upload(owner, bike, jpeg, "text/plain"),
    415,
    "unsupported_media_type",
    "a declared type that is no image",
  );
  assertError(
    await upload(other, bike, jpeg),
    404,
    "not_found",
    "a bicycle of someone else",
  );
  assertError(
    await upload(owner, randomUUID(), jpeg),
    404,
    "not_found",
    "a bicycle that does not exist",
  );
  assertError(
    await upload(
      owner,
      bike,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      "image/png",
    ),
    415,
    "unsupported_media_type",
    "bytes that are no JPEG, PNG or WebP, whatever the header says",
  );
  assertError(
    await upload(
      owner,
      bike,
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200, 7)]),
    ),
    400,
    "invalid_request",
    "a file that starts like a JPEG but is none",
  );
  assertError(
    await upload(owner, bike, await image(200, 150, "#000000")),
    400,
    "invalid_request",
    "a photo that is too small",
  );
  assertError(
    await upload(owner, bike, Buffer.alloc(10 * 1024 * 1024 + 1, 1)),
    413,
    "payload_too_large",
    "a file over 10 MB",
  );
  assertError(
    await upload(owner, bike, Buffer.alloc(0)),
    400,
    "invalid_request",
    "an empty body",
  );

  // ---- Upload, replay, conflict --------------------------------------------
  const firstKey = randomUUID();
  const first = await upload(owner, bike, jpeg, "image/jpeg", {
    "Idempotency-Key": firstKey,
  });
  assert.equal(first.status, 201, first.text);
  const cover = photoSchema.parse(first.body);
  assert.equal(cover.isCover, true, "the first photo is the cover");
  assert.equal(cover.url, `/api/photos/${cover.id}`);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.ok(
    existsSync(path.join(uploads(), cover.id + ".webp")),
    "the file is stored as WebP",
  );

  const replay = await upload(owner, bike, jpeg, "image/jpeg", {
    "Idempotency-Key": firstKey,
  });
  assert.equal(replay.status, 201, replay.text);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.equal(replay.body.id, cover.id, "a repeat adds no second photo");
  assertError(
    await upload(owner, bike, png, "image/png", {
      "Idempotency-Key": firstKey,
    }),
    409,
    "conflict",
    "the same key with another file",
  );

  // The type is read from the bytes: octet-stream is as good as an image type.
  const second = await upload(owner, bike, png, "application/octet-stream");
  assert.equal(second.status, 201, second.text);
  assert.equal(second.body.isCover, false, "only the first photo is the cover");
  const third = await upload(owner, bike, webp, "image/webp");
  assert.equal(third.status, 201, third.text);

  // Parallel retries of one upload make one photo.
  const parallelKey = randomUUID();
  const parallelBytes = await image(1000, 700, "#cc8844");
  const parallel = await Promise.all(
    Array.from({ length: 5 }, () =>
      upload(owner, bike, parallelBytes, "image/jpeg", {
        "Idempotency-Key": parallelKey,
      }),
    ),
  );
  for (const r of parallel) assert.equal(r.status, 201, r.text);
  assert.equal(new Set(parallel.map((r) => r.body.id)).size, 1);

  // ---- The bicycle shows the same state ------------------------------------
  const read = await owner.token(`/bikes/${bike}`);
  const shown = bikeSchema.parse(read.body);
  assert.equal(shown.photos.length, 4);
  assert.equal(shown.photoCount, 4);
  assert.equal(shown.coverPhoto.id, cover.id);
  assert.deepEqual(
    shown.photos.filter((p) => p.isCover).map((p) => p.id),
    [cover.id],
  );
  // The owner reads the file with the same Bearer token; nobody else can.
  const served = await http(`/api/photos/${cover.id}`, {
    headers: { authorization: owner.bearer },
  });
  assert.equal(served.status, 200, "the owner reads the private photo");
  assert.equal(served.headers.get("content-type"), "image/webp");
  assert.equal((await sharp(served.bytes).metadata()).format, "webp");
  assert.equal(
    (await http(`/api/photos/${cover.id}`)).status,
    404,
    "a private bicycle's photo is hidden from guests",
  );
  assert.equal(
    (
      await http(`/api/photos/${cover.id}`, {
        headers: { authorization: other.bearer },
      })
    ).status,
    404,
    "and from other people",
  );

  // ---- The cover ----------------------------------------------------------
  const target = second.body.id;
  assertError(
    await other.token(`/bikes/${bike}/photos/${target}/cover`, {
      method: "PUT",
    }),
    404,
    "not_found",
    "someone else's bicycle",
  );
  assertError(
    await owner.token(`/bikes/${bike}/photos/${randomUUID()}/cover`, {
      method: "PUT",
    }),
    404,
    "not_found",
    "a photo that is not here",
  );
  const covered = await owner.token(`/bikes/${bike}/photos/${target}/cover`, {
    method: "PUT",
  });
  assert.equal(covered.status, 200, covered.text);
  const after = bikeSchema.parse(covered.body);
  assert.equal(after.coverPhoto.id, target);
  assert.deepEqual(
    after.photos.filter((p) => p.isCover).map((p) => p.id),
    [target],
    "exactly one cover",
  );
  assert.ok(covered.headers.get("etag"));
  const again = await owner.token(`/bikes/${bike}/photos/${target}/cover`, {
    method: "PUT",
  });
  assert.equal(again.status, 200, "setting the cover again changes nothing");

  // ---- Deleting: the cover goes to the oldest that is left ---------------
  const removed = await owner.token(`/bikes/${bike}/photos/${target}`, {
    method: "DELETE",
  });
  assert.equal(removed.status, 204, removed.text);
  assert.ok(
    !existsSync(path.join(uploads(), target + ".webp")),
    "the file is gone with the photo",
  );
  const fallback = bikeSchema.parse((await owner.token(`/bikes/${bike}`)).body);
  assert.equal(fallback.photos.length, 3);
  assert.equal(
    fallback.coverPhoto.id,
    cover.id,
    "the oldest remaining photo is the cover now",
  );
  assert.equal(
    (await owner.token(`/bikes/${bike}/photos/${target}`, { method: "DELETE" }))
      .status,
    204,
    "a repeat is 204 too",
  );
  assertError(
    await other.token(`/bikes/${bike}/photos/${cover.id}`, {
      method: "DELETE",
    }),
    404,
    "not_found",
    "removing from someone else's bicycle",
  );

  // ---- Limits of the site ---------------------------------------------------
  const crowded = await newBike(owner, { name: "Много фото" });
  const small = await image(800, 600, "#223344");
  for (let n = 0; n < 12; n++) {
    const r = await upload(
      owner,
      crowded,
      await image(800, 600, `#${(0x112233 + n * 0x010101).toString(16)}`),
    );
    assert.equal(r.status, 201, `photo ${n}: ${r.text}`);
  }
  assertError(
    await upload(owner, crowded, small),
    409,
    "conflict",
    "the 13th photo of one bicycle",
  );

  // A photo on a public bicycle is a public write: it needs a confirmed address.
  const draft = await newBike(mailless);
  await db.query("UPDATE bikes SET is_public=true WHERE id=$1", [draft]);
  assertError(
    await upload(mailless, draft, jpeg),
    403,
    "email_verification_required",
    "a photo on a public bicycle without a confirmed address",
  );

  // Deleting the bicycle takes its photos and their files with it.
  const doomed = await newBike(owner, { name: "На удаление" });
  const lone = await upload(owner, doomed, jpeg);
  assert.equal(lone.status, 201, lone.text);
  assert.ok(existsSync(path.join(uploads(), lone.body.id + ".webp")));
  assert.equal(
    (await owner.token(`/bikes/${doomed}`, { method: "DELETE" })).status,
    204,
  );
  assert.ok(!existsSync(path.join(uploads(), lone.body.id + ".webp")));
  console.log(
    "API v1 bike photos HTTP: raw upload with a file key, replay and parallel retry, cover, deletion and limits passed.",
  );
} finally {
  await db.end();
}
