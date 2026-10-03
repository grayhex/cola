// API v1, media with a Bearer token (#324), through the real server and
// PostgreSQL: the photo URLs that /api/v1 returns are read by the owner with
// the token of a device session, the same as with the cookie, and not by a
// stranger or a guest; ETag/304 and width variants work with the token; every
// answer that depends on who asks varies by Cookie and Authorization.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const run = randomUUID().slice(0, 8);
const password = "media-http-password-123";

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
  const email = `media-${label}-${run}@example.test`;
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
    // A new device session of the same person (after the first was revoked).
    grant: async () => {
      const again = await http("/api/v1/auth/sessions", {
        method: "POST",
        body: {
          email,
          password,
          device: { name: "Второй " + label, platform: "ios" },
        },
      });
      assert.equal(again.status, 201, again.text);
      return "Bearer " + again.body.accessToken;
    },
    cookie: withCookie,
    token: withToken,
  };
}
const picture = await sharp({
  create: { width: 1200, height: 800, channels: 3, background: "#5b8a72" },
})
  .jpeg()
  .toBuffer();
const upload = async (who, path, type) => {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { cookie: who.cookieValue(), origin: base, "content-type": type },
    body: picture,
  });
  const text = await response.text();
  assert.equal(response.status, 201, path + " " + text);
  return JSON.parse(text);
};
const media = (path, credential, extra = {}) =>
  fetch(base + path, {
    headers: { ...(credential ? { authorization: credential } : {}), ...extra },
  });
const width = async (response) =>
  (await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width;
const bikeBody = (name, isPublic) => ({
  name,
  brand: "Cube",
  model: "Nuroad",
  year: 2024,
  category: "gravel",
  description: "",
  color: "",
  size: "",
  weight: null,
  is_public: isPublic,
});

try {
  const owner = await member("owner");
  const stranger = await member("stranger");

  // A private bike's photo.
  const closed = (
    await owner.web("/bikes", "POST", bikeBody("Закрытый " + run, false))
  ).body.id;
  const photo = await upload(
    owner,
    `/api/bikes/${closed}/photos`,
    "image/jpeg",
  );
  const url = "/api/photos/" + photo.id;
  const ownerToken = await owner.bearer();
  // The URL the API itself returns is the one fetched.
  const card = await owner.token("/bikes/" + closed);
  assert.equal(card.status, 200, card.text);
  assert.equal(card.body.photos[0].url, url);

  const ok = await media(url, ownerToken);
  assert.equal(ok.status, 200, "owner with a token");
  assert.equal(ok.headers.get("content-type"), "image/webp");
  assert.match(ok.headers.get("vary") || "", /\bCookie\b/);
  assert.match(ok.headers.get("vary") || "", /\bAuthorization\b/);
  assert.equal(await width(ok), 1200);
  const variant = await media(url + "?width=320", ownerToken);
  assert.equal(variant.status, 200);
  assert.equal(await width(variant), 320);
  const etag = variant.headers.get("etag");
  const revalidated = await media(url + "?width=320", ownerToken, {
    "if-none-match": etag,
  });
  assert.equal(revalidated.status, 304);
  assert.match(revalidated.headers.get("vary") || "", /\bAuthorization\b/);
  // The web is unchanged: the owner's cookie still reads it.
  assert.equal(
    (await media(url, null, { cookie: owner.cookieValue() })).status,
    200,
  );
  // Nobody else: a guest, a stranger with a token, a stranger's cookie.
  assert.equal((await media(url, null)).status, 404, "guest");
  assert.equal(
    (await media(url, await stranger.bearer())).status,
    404,
    "stranger with a token",
  );
  assert.equal(
    (await media(url, null, { cookie: stranger.cookieValue() })).status,
    404,
    "stranger cookie",
  );
  // A token that finds nobody is refused, never read as a guest.
  const bad = await media(url, "Bearer cola_at_" + "A".repeat(43));
  assert.equal(bad.status, 401, "unknown token");
  assert.match(bad.headers.get("www-authenticate") || "", /Bearer/);
  assert.equal(
    (await media(url, ownerToken, { cookie: owner.cookieValue() })).status,
    400,
    "a token and a cookie together",
  );
  // Revoking the device session stops the token at once.
  const ended = await owner.token("/auth/sessions/current", {
    method: "DELETE",
  });
  assert.equal(ended.status, 204, ended.text);
  assert.equal((await media(url, ownerToken)).status, 401, "revoked token");

  // A journal draft's picture.
  const reader = await member("reader");
  const bike = (
    await owner.web("/bikes", "POST", bikeBody("Публичный " + run, true))
  ).body.id;
  const draft = await owner.web("/journal", "POST", {
    bikeId: bike,
    kind: "story",
    title: "Черновик",
    body: "Текст",
    status: "draft",
    isPublic: false,
  });
  assert.equal(draft.status, 201, draft.text);
  const journalPhoto = await upload(
    owner,
    `/api/journal/${draft.body.id}/photos`,
    "application/octet-stream",
  );
  const journalUrl = "/api/journal/media/" + journalPhoto.id;
  const again = await owner.grant();
  assert.equal(
    (await media(journalUrl, again)).status,
    200,
    "owner with a token: draft",
  );
  assert.equal((await media(journalUrl, null)).status, 404, "guest: draft");
  assert.equal(
    (await media(journalUrl, await reader.bearer())).status,
    404,
    "stranger with a token: draft",
  );
  assert.match(
    (await media(journalUrl, again)).headers.get("vary") || "",
    /\bAuthorization\b/,
  );
  // A published entry's picture is public, with or without a token.
  const published = await owner.web("/journal", "POST", {
    bikeId: bike,
    kind: "story",
    title: "Опубликовано",
    body: "Текст",
    status: "published",
    isPublic: true,
  });
  const openPhoto = await upload(
    owner,
    `/api/journal/${published.body.id}/photos`,
    "application/octet-stream",
  );
  const openUrl = "/api/journal/media/" + openPhoto.id;
  assert.equal((await media(openUrl, null)).status, 200, "public: guest");
  assert.equal(
    (await media(openUrl, await reader.bearer())).status,
    200,
    "public: reader token",
  );
  // Public bike photos stay readable by a guest.
  const publicPhoto = await upload(
    owner,
    `/api/bikes/${bike}/photos`,
    "image/jpeg",
  );
  const publicUrl = "/api/photos/" + publicPhoto.id;
  assert.equal(
    (await media(publicUrl, null)).status,
    200,
    "public bike: guest",
  );
  assert.equal(
    (await media(publicUrl, await reader.bearer())).status,
    200,
    "public bike: reader token",
  );

  // Every media route of the API's URLs refuses a bad token before looking anything up.
  for (const path of [
    "/api/photos/" + randomUUID(),
    "/api/journal/media/" + randomUUID(),
    "/api/components/media/" + randomUUID(),
    "/api/market/media/" + randomUUID(),
  ])
    assert.equal(
      (await media(path, "Bearer cola_at_" + "B".repeat(43))).status,
      401,
      path,
    );

  console.log("api v1 media http: ok");
} finally {
  await db.end();
}
