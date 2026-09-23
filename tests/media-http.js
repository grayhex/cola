// Media delivery: size variants, revalidation (ETag/304) and access re-checks.
import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
function client() {
  let cookie = "";
  const call = async (url, method = "GET", data, type) => {
    const binary = Buffer.isBuffer(data);
    const response = await fetch(base + "/api/" + url, {
      method,
      headers: {
        origin: base,
        ...(cookie ? { cookie } : {}),
        ...(data ? { "Content-Type": type || (binary ? "application/octet-stream" : "application/json") } : {}),
      },
      body: data ? (binary ? data : JSON.stringify(data)) : undefined,
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: response.status, body: await response.json() };
  };
  // Raw GET that keeps the session and optional revalidation header.
  call.cookie = () => cookie;
  call.raw = (url, etag) =>
    fetch(base + url, {
      headers: { ...(cookie ? { cookie } : {}), ...(etag ? { "If-None-Match": etag } : {}) },
    });
  return call;
}
const owner = client(),
  guest = client(),
  nonce = randomUUID().slice(0, 8);
const register = (c, name) =>
  c("auth/register", "POST", {
    ...testConsents,
    name,
    email: `media-${name}-${nonce}@example.test`,
    password: "media-http-secret-123",
  });
assert.equal((await register(owner, "owner")).status, 201);
const photo = await sharp({
  create: { width: 1600, height: 1000, channels: 3, background: "#5b8a72" },
})
  .jpeg()
  .toBuffer();
const width = async (response) => (await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width;

// Bike photos: variants, ETag, 304 and revocation on hide.
const bike = (
  await owner("bikes", "POST", {
    name: "Media bike",
    brand: "Cube",
    model: "Nuroad",
    year: 2024,
    category: "gravel",
    description: "",
    color: "",
    size: "",
    weight: null,
    is_public: true,
  })
).body.id;
const uploaded = await owner(`bikes/${bike}/photos`, "POST", photo, "image/jpeg");
assert.equal(uploaded.status, 201);
const photoUrl = "/api/photos/" + uploaded.body.id;
const variant = await guest.raw(photoUrl + "?width=640");
assert.equal(variant.status, 200);
assert.equal(variant.headers.get("content-type"), "image/webp");
assert.equal(variant.headers.get("cache-control"), "private, no-cache");
const etag = variant.headers.get("etag");
assert.match(etag, /^"v1-[0-9a-f-]{36}-640"$/);
assert.equal(await width(variant), 640);
const original = await guest.raw(photoUrl);
assert.equal(original.status, 200);
assert.equal(await width(original), 1600);
assert.notEqual(original.headers.get("etag"), etag);
const revalidated = await guest.raw(photoUrl + "?width=640", etag);
assert.equal(revalidated.status, 304);
assert.equal((await revalidated.arrayBuffer()).byteLength, 0);
assert.equal((await guest.raw(photoUrl + "?width=641")).status, 400);
assert.equal((await guest.raw(photoUrl + "?width=2400")).status, 400);
// Hiding the bike revokes cached copies: the guest's revalidation gets 404.
assert.equal((await owner(`bikes/${bike}/share`, "PATCH", { is_public: false })).status, 200);
assert.equal((await guest.raw(photoUrl + "?width=640", etag)).status, 404);
assert.equal((await owner.raw(photoUrl + "?width=640", etag)).status, 304);
// Deleting the photo removes it for the owner as well, cached variant included.
assert.equal((await owner(`bikes/${bike}/photos/${uploaded.body.id}`, "DELETE")).status, 200);
assert.equal((await owner.raw(photoUrl + "?width=640")).status, 404);

// Avatars: small variants only.
const avatarUpload = await fetch(base + "/api/social/me/avatar", {
  method: "PUT",
  headers: { origin: base, cookie: owner.cookie(), "Content-Type": "image/jpeg" },
  body: photo,
});
assert.equal(avatarUpload.status, 200, await avatarUpload.clone().text());
const avatarUrl = (await avatarUpload.json()).avatar;
const avatar = await guest.raw(avatarUrl + "?width=160");
assert.equal(avatar.status, 200);
assert.equal(await width(avatar), 160);
assert.equal((await guest.raw(avatarUrl + "?width=160", avatar.headers.get("etag"))).status, 304);
assert.equal((await guest.raw(avatarUrl + "?width=640")).status, 400);

// Journal media follows entry visibility.
const publicBike = (
  await owner("bikes", "POST", {
    name: "Journal media bike",
    brand: "Cube",
    model: "Nuroad",
    year: 2024,
    category: "gravel",
    description: "",
    color: "",
    size: "",
    weight: null,
    is_public: true,
  })
).body.id;
const entry = await owner("journal", "POST", {
  bikeId: publicBike,
  kind: "story",
  title: "Media story",
  body: "Text",
  status: "published",
  isPublic: true,
});
assert.equal(entry.status, 201);
const journalPhoto = await owner(`journal/${entry.body.id}/photos`, "POST", photo);
assert.equal(journalPhoto.status, 201);
const journalUrl = "/api/journal/media/" + journalPhoto.body.id;
const journalVariant = await guest.raw(journalUrl + "?width=320");
assert.equal(journalVariant.status, 200);
assert.equal(await width(journalVariant), 320);
// Next.js adds its own Vary entries; the private response must vary by Cookie.
assert.match(journalVariant.headers.get("vary") || "", /\bCookie\b/);
const journalTag = journalVariant.headers.get("etag");
assert.equal((await guest.raw(journalUrl + "?width=320", journalTag)).status, 304);

// Market media, including sizes for cards and detail.
const listing = await owner("market", "POST", {
  title: "Media wheels",
  description: "Wheels",
  category: "components",
  listingType: "sale",
  condition: "used",
  price: 1000,
  currency: "RUB",
  location: "",
  contact: "",
  status: "active",
});
assert.equal(listing.status, 201);
const marketPhoto = await owner(`market/${listing.body.id}/photos`, "POST", photo, "image/jpeg");
assert.equal(marketPhoto.status, 201, JSON.stringify(marketPhoto.body));
const marketId = marketPhoto.body.id;
const marketUrl = "/api/market/media/" + marketId;
for (const size of [320, 640, 1280]) {
  const response = await guest.raw(`${marketUrl}?width=${size}`);
  assert.equal(response.status, 200);
  assert.equal(await width(response), Math.min(size, 1600));
}
assert.equal((await guest.raw(marketUrl + "?width=999")).status, 400);

// Site graphics are public and immutable.
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const me = (await owner("me")).body.user;
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [me.id]);
  const assetUpload = await fetch(base + "/api/admin/assets?name=Media%20test", {
    method: "POST",
    headers: { origin: base, cookie: owner.cookie(), "Content-Type": "image/png" },
    body: await sharp({ create: { width: 40, height: 30, channels: 4, background: "#335577" } }).png().toBuffer(),
  });
  assert.equal(assetUpload.status, 201);
  const assetId = (await assetUpload.json()).id;
  const asset = await guest.raw("/api/assets/" + assetId);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.ok(asset.headers.get("content-security-policy"));
  assert.equal((await guest.raw("/api/assets/" + assetId, asset.headers.get("etag"))).status, 304);
  assert.equal((await owner("admin/assets/" + assetId, "DELETE")).status, 200);
  assert.equal((await guest.raw("/api/assets/" + assetId)).status, 404);
} finally {
  await db.end();
}
console.log(
  "Media HTTP: size variants, ETag/304, revocation on hide/delete, avatars, journal, market and immutable site graphics passed.",
);

