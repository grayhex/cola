// Use only with scripts/test-db.js and the app pointed to that disposable database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
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
const admin = client(),
  member = client(),
  guest = client();
const id = randomUUID(),
  password = "disposable-test-12345";
let original, originalCatalog, asset, adminId, memberId;
try {
  assert.equal((await guest("admin/overview")).status, 401);
  const a = await admin("auth/register", "POST", {
    name: "Admin test",
    email: `admin-${id}@example.test`,
    password,
    role: "admin",
  });
  adminId = a.data.user.id;
  assert.equal(
    (await admin("admin/overview")).status,
    403,
    "registration cannot grant admin",
  );
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [adminId]);
  const m = await member("auth/register", "POST", {
    name: "Member test",
    email: `member-${id}@example.test`,
    password,
  });
  memberId = m.data.user.id;
  assert.equal((await member("admin/users")).status, 403);
  const overview = await admin("admin/overview");
  assert.equal(overview.status, 200);
  original = overview.data.settings;
  originalCatalog = overview.data.catalog;
  assert.equal(
    (
      await admin(
        "admin/settings",
        "PUT",
        { value: original, version: overview.data.settingsVersion },
        "https://evil.example",
      )
    ).status,
    403,
  );
  const updated = {
    ...original,
    appearance: { theme: "dark", accent: "#F3B51B" },
    summaryPosition: "left",
    copy: { ...original.copy, "Мой гараж": "Моя коллекция" },
  };
  assert.equal(
    (
      await admin("admin/settings", "PUT", {
        value: updated,
        version: overview.data.settingsVersion,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await admin("admin/settings", "PUT", {
        value: original,
        version: overview.data.settingsVersion,
      })
    ).status,
    409,
  );
  const site = (await guest("site")).data;
  assert.equal(site.settings.appearance.theme, "dark");
  assert.equal(site.settings.copy["Мой гараж"], "Моя коллекция");
  const cat = structuredClone(originalCatalog);
  cat.manufacturers.push("Test Manufacturer");
  cat.parts["Седло"].push("Test Saddle");
  cat.icons["Седло"] = "saddle";
  assert.equal(
    (
      await admin("admin/catalog", "PUT", {
        value: cat,
        version: site.catalogVersion,
      })
    ).status,
    200,
  );
  assert.ok(
    (await guest("site")).data.catalog.parts["Седло"].includes("Test Saddle"),
  );
  const bytes = await sharp({
    create: { width: 40, height: 30, channels: 4, background: "#007766" },
  })
    .png()
    .toBuffer();
  const { cookie } = await admin("me");
  const upload = await fetch(base + "/api/admin/assets?name=Test%20graphic", {
    method: "POST",
    headers: { origin: base, cookie, "Content-Type": "image/png" },
    body: bytes,
  });
  assert.equal(upload.status, 201);
  asset = (await upload.json()).id;
  assert.equal((await fetch(base + "/api/assets/" + asset)).status, 200);
  let latest = (await admin("admin/overview")).data;
  assert.equal(
    (
      await admin("admin/settings", "PUT", {
        value: {
          ...latest.settings,
          faviconId: asset,
          registrationOpen: false,
        },
        version: latest.settingsVersion,
      })
    ).status,
    200,
  );
  assert.equal(
    (await admin("admin/assets/" + asset, "DELETE")).status,
    409,
    "in-use assets are protected",
  );
  latest = (await admin("admin/overview")).data;
  assert.equal(
    (
      await admin("admin/settings", "PUT", {
        value: {
          ...latest.settings,
          faviconId: null,
          mtbImageId: asset,
          roadImageId: asset,
          gravelImageId: asset,
          bikeLayout: "dense",
        },
        version: latest.settingsVersion,
      })
    ).status,
    200,
  );
  assert.equal(
    (await admin("admin/assets/" + asset, "DELETE")).status,
    409,
    "stock category images are protected without a logo reference",
  );
  const themed = (await (await fetch(base + "/api/site")).json()).settings;
  assert.equal(themed.bikeLayout, "dense");
  assert.equal(themed.mtbImageId, asset);
  assert.equal(
    (
      await guest("auth/register", "POST", {
        name: "Closed",
        email: `closed-${id}@example.test`,
        password,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await admin("admin/users/" + adminId, "PATCH", {
        name: "Admin test",
        email: `admin-${id}@example.test`,
        role: "user",
        blocked: false,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await admin("admin/users/" + memberId, "PATCH", {
        name: "Blocked test",
        email: `member-${id}@example.test`,
        role: "user",
        blocked: true,
      })
    ).status,
    200,
  );
  assert.equal((await member("bikes")).status, 401);
  assert.equal(
    (
      await member("auth/login", "POST", {
        email: `member-${id}@example.test`,
        password,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await admin("admin/users/" + memberId, "DELETE", {
        confirmEmail: "wrong",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await admin("admin/users/" + memberId, "DELETE", {
        confirmEmail: `member-${id}@example.test`,
      })
    ).status,
    200,
  );
  memberId = null;
  assert.ok((await admin("admin/audit")).data.events.length >= 5);
  console.log(
    "PASS: admin authorization, CSRF, version conflicts, persisted theme/copy/catalog, graphics, registration toggle, protected admin, blocked sessions, user deletion and audit.",
  );
} finally {
  if (original) {
    const latest = (await admin("admin/overview")).data;
    await admin("admin/settings", "PUT", {
      value: original,
      version: latest.settingsVersion,
    });
    await admin("admin/catalog", "PUT", {
      value: originalCatalog,
      version: latest.catalogVersion,
    });
  }
  if (asset) await admin("admin/assets/" + asset, "DELETE");
  if (memberId) await db.query("DELETE FROM users WHERE id=$1", [memberId]);
  if (adminId) await db.query("DELETE FROM users WHERE id=$1", [adminId]);
  await db.end();
}
