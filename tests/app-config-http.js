// Use only with scripts/test-db.js and the app pointed to that disposable database.
// The native app settings end to end (#338): the public GET /api/v1/app-config
// with its cache validators, and the admin API that feeds it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { appConfigSchema } from "../lib/api-v1/schemas.ts";
import { testConsents } from "./fixtures/legal.js";

const base = process.env.TEST_ORIGIN || "http://localhost:3000";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
function client() {
  let cookie = "";
  return async (p, m = "GET", data, origin = base) => {
    const r = await fetch(base + "/api/" + p, {
      method: m,
      headers: {
        origin,
        ...(cookie ? { cookie } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, data: await r.json(), cookie };
  };
}
const config = (headers = {}, method = "GET") =>
  fetch(base + "/api/v1/app-config", { method, headers });
const admin = client(),
  member = client(),
  guest = client();
const id = randomUUID(),
  password = "disposable-test-12345";
let adminId, memberId, asset, original;
try {
  // Guests read the public settings; nothing about the reader matters.
  const first = await config();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "public, max-age=60");
  assert.equal(first.headers.get("x-content-type-options"), "nosniff");
  assert.ok(first.headers.get("x-request-id"));
  const etag = first.headers.get("etag");
  assert.match(etag, /^"app-config-[\w-]{32}"$/);
  const body = await first.json();
  assert.deepEqual(appConfigSchema.parse(body), body);
  assert.equal(body.notice, null);
  assert.match(body.links.privacy, /\/legal\/privacy$/);
  for (const headers of [
    { "If-None-Match": etag },
    { "If-None-Match": `"stale", W/${etag}` },
  ]) {
    const cached = await config(headers);
    assert.equal(cached.status, 304);
    assert.equal(cached.headers.get("etag"), etag);
    assert.equal(cached.headers.get("cache-control"), "public, max-age=60");
    assert.equal(await cached.text(), "");
  }
  assert.equal((await config({ "If-None-Match": '"stale"' })).status, 200);
  // Credentials are not read here: a bad token or a cookie changes nothing.
  for (const headers of [
    { Authorization: "Bearer cola_at_invalid" },
    { Authorization: "Basic eDp5" },
    { cookie: "cola_session=forged" },
  ]) {
    const answer = await config(headers);
    assert.equal(answer.status, 200, JSON.stringify(headers));
    assert.equal(answer.headers.get("etag"), etag);
  }
  const head = await config({}, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("etag"), etag);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const refused = await config({}, method);
    assert.equal(refused.status, 405, method);
    assert.equal(refused.headers.get("allow"), "GET, HEAD, OPTIONS");
    assert.equal((await refused.json()).error.code, "method_not_allowed");
  }

  // The admin API: admins only, same origin for changes.
  assert.equal((await guest("admin/mobile")).status, 401);
  const a = await admin("auth/register", "POST", {
    ...testConsents,
    name: "Mobile admin",
    email: `mobile-admin-${id}@example.test`,
    password,
  });
  adminId = a.data.user.id;
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [adminId]);
  const m = await member("auth/register", "POST", {
    ...testConsents,
    name: "Mobile member",
    email: `mobile-member-${id}@example.test`,
    password,
  });
  memberId = m.data.user.id;
  assert.equal((await member("admin/mobile")).status, 403);
  const loaded = await admin("admin/mobile");
  assert.equal(loaded.status, 200);
  original = loaded.data;
  assert.deepEqual(original.published, body);
  // The harness sets up Yandex ID with the app's return link, not chat.
  assert.deepEqual(original.readiness, { chat: false, yandex: true });
  assert.equal(
    (
      await member("admin/mobile", "PUT", {
        value: original.value,
        version: original.version,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await admin(
        "admin/mobile",
        "PUT",
        { value: original.value, version: original.version },
        "https://evil.example",
      )
    ).status,
    403,
  );

  // An image for the launch screen, uploaded through the media library.
  const bytes = await sharp({
    create: { width: 90, height: 160, channels: 3, background: "#f3b51b" },
  })
    .png()
    .toBuffer();
  const { cookie } = await admin("me");
  const upload = await fetch(base + "/api/admin/assets?name=launch.png", {
    method: "POST",
    headers: { origin: base, cookie, "Content-Type": "image/png" },
    body: bytes,
  });
  assert.equal(upload.status, 201);
  asset = (await upload.json()).id;
  const value = {
    ...original.value,
    launch: {
      enabled: true,
      assetId: asset,
      name: "Секретная кампания",
      contentMode: "crop",
      title: "Добро пожаловать",
    },
    notice: {
      enabled: true,
      kind: "promo",
      title: "Покатушки выходного дня",
      body: "Присоединяйтесь",
      assetId: null,
      actionLabel: "Открыть",
      actionUrl: "/rides",
    },
    features: {
      ...original.value.features,
      market: false,
      rideRecording: true,
    },
  };
  const saved = await admin("admin/mobile", "PUT", {
    value,
    version: original.version,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.version, original.version + 1);

  // Apps see the new revision at once, and only public fields.
  const changed = await config({ "If-None-Match": etag });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("etag"), etag);
  const published = await changed.json();
  assert.deepEqual(appConfigSchema.parse(published), published);
  assert.equal(published.revision, saved.data.version);
  assert.deepEqual(published.launch, {
    enabled: true,
    imageUrl: "/api/assets/" + asset,
    contentMode: "crop",
    title: "Добро пожаловать",
  });
  assert.equal(published.notice.kind, "promo");
  assert.equal(published.notice.revision, saved.data.version);
  assert.equal(published.notice.action.label, "Открыть");
  assert.match(published.notice.action.url, /^https?:\/\/[^/]+\/rides$/);
  assert.equal(published.features.market, false);
  assert.equal(published.features.rideRecording, true);
  assert.equal(published.features.chat, false, "chat is not set up here");
  assert.equal(published.features.nativeYandexSignIn, true);
  const text = JSON.stringify(published);
  assert.doesNotMatch(
    text,
    /Секретная кампания|externalHosts|assetId|mobile-admin|example\.test|fixture-yandex|secret/,
  );
  const image = await fetch(base + published.launch.imageUrl + "?width=640");
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/webp");
  await image.arrayBuffer();

  // Another admin's stale version, unsafe links, unconfirmed hard updates.
  const stale = await admin("admin/mobile", "PUT", {
    value,
    version: original.version,
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, "version_conflict");
  const unsafe = await admin("admin/mobile", "PUT", {
    value: {
      ...value,
      notice: { ...value.notice, actionUrl: "javascript:alert(1)" },
    },
    version: saved.data.version,
  });
  assert.equal(unsafe.status, 400);
  assert.equal(unsafe.data.code, "invalid_settings");
  assert.deepEqual(
    unsafe.data.problems.map((p) => p.path),
    ["notice.actionUrl"],
  );
  const markup = await admin("admin/mobile", "PUT", {
    value: { ...value, layout: { screens: [] } },
    version: saved.data.version,
  });
  assert.equal(markup.status, 400);
  const hard = {
    ...value,
    compatibility: {
      minimumSupportedVersionCode: 3,
      latestVersionCode: 4,
      updateMode: "hard",
      updateUrl: "/about",
      updateMessage: null,
    },
  };
  const unconfirmed = await admin("admin/mobile", "PUT", {
    value: hard,
    version: saved.data.version,
  });
  assert.equal(unconfirmed.status, 428);
  assert.deepEqual(unconfirmed.data.confirm, ["hardUpdate"]);
  assert.equal(
    (await config()).headers.get("etag"),
    changed.headers.get("etag"),
    "refused saves publish nothing",
  );

  // The assigned image is used: neither delete path removes it.
  assert.equal((await admin("admin/assets/" + asset, "DELETE")).status, 409);
  const library = await admin("admin/assets/library");
  assert.deepEqual(
    library.data.assets.find((entry) => entry.id === asset).usage,
    ["Мобильное приложение"],
  );
  const bulk = await admin("admin/assets/library", "DELETE", { ids: [asset] });
  assert.equal(bulk.status, 200);
  assert.deepEqual(bulk.data.skippedIds, [asset]);
  assert.ok(
    (await admin("admin/audit")).data.events.some(
      (event) =>
        event.action === "mobile.update" &&
        event.target === String(saved.data.version),
    ),
  );
  console.log(
    "PASS: public app config (guest read, ETag/304, cache, allowlisted fields, no credentials read), admin-only versioned saves, link allowlist, hard-update confirmation and protected mobile images.",
  );
} finally {
  if (original) {
    const latest = (await admin("admin/mobile")).data;
    await admin("admin/mobile", "PUT", {
      value: original.value,
      version: latest.version,
    });
  }
  if (asset) await admin("admin/assets/" + asset, "DELETE");
  if (memberId) await db.query("DELETE FROM users WHERE id=$1", [memberId]);
  if (adminId) await db.query("DELETE FROM users WHERE id=$1", [adminId]);
  await db.end();
}
