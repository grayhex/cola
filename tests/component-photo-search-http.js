import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { verifiedFetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
const base = process.env.TEST_ORIGIN || "http://localhost:3100",
  nonce = randomUUID().slice(0, 8);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const ids = [];
function client() {
  let cookie = "";
  const call = async (path, method = "GET", data, origin = base) => {
    const r = await verifiedFetch(base + "/api/" + path, {
      method,
      headers: { cookie, origin, "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, body: await r.json() };
  };
  call.image = (path) => fetch(base + "/api/" + path, { headers: { cookie } });
  return call;
}
const expectStatus = async (work, status) => {
  const r = await work;
  assert.equal(r.status, status, JSON.stringify(r));
  return r.body;
};
try {
  const owner = client(),
    a = client(),
    b = client(),
    guest = client();
  for (const [i, api] of [owner, a, b].entries()) {
    const r = await expectStatus(
      api("auth/register", "POST", {
        ...testConsents,
        name: "Photo search " + i + nonce,
        email: `photo-search-${i}-${nonce}@example.test`,
        password: "photo-search-tests-123",
      }),
      201,
    );
    ids.push(r.user.id);
  }
  const bike = await expectStatus(
    owner("bikes/wizard", "POST", {
      requestId: randomUUID(),
      bike: {
        name: "Photo source",
        brand: "Cube",
        model: "Travel",
        year: 2024,
        category: "road",
        is_public: true,
        description: "",
        color: "",
        size: "",
        weight: null,
      },
      components: ["Search", "Other", "NoPhotos", "UpstreamError"].map((v) => ({
        section: "build",
        category: "Седло",
        name: "Brooks " + v + nonce,
        notes: "",
        price: null,
      })),
    }),
    201,
  );
  const models = (
    await db.query("SELECT name,model_id FROM components WHERE bike_id=$1", [
      bike.id,
    ])
  ).rows;
  const model = (name) =>
    models.find((v) => v.name.startsWith("Brooks " + name)).model_id;
  const path = "components/" + model("Search"),
    other = "components/" + model("Other");
  await expectStatus(guest(path + "/photo-search", "POST", {}), 401);
  await expectStatus(
    a(path + "/photo-search", "POST", {}, "https://evil.test"),
    403,
  );
  const first = await expectStatus(a(path + "/photo-search", "POST", {}), 200);
  const second = await expectStatus(b(path + "/photo-search", "POST", {}), 200);
  assert.equal(first.photos.length, 2);
  assert.equal(
    (await b.image(path + "/photo-candidates/" + first.photos[0].id)).status,
    404,
  );
  assert.equal(
    (await a.image(other + "/photo-candidates/" + first.photos[0].id)).status,
    404,
  );
  const preview = await a.image(
    path + "/photo-candidates/" + first.photos[0].id,
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "image/webp");
  assert.match(preview.headers.get("cache-control"), /no-store/);
  await expectStatus(
    a(path + "/photos/import", "POST", {
      ids: [first.photos[0].id],
      confirmed: false,
    }),
    400,
  );
  await expectStatus(
    a(path + "/photos/import", "POST", {
      ids: [first.photos[0].id],
      confirmed: true,
      url: "http://169.254.169.254/",
    }),
    400,
  );
  // Two different users race the empty gallery on real PostgreSQL in CI.
  const races = await Promise.all([
    a(path + "/photos/import", "POST", {
      ids: first.photos.map((p) => p.id),
      confirmed: true,
    }),
    b(path + "/photos/import", "POST", {
      ids: second.photos.map((p) => p.id),
      confirmed: true,
    }),
  ]);
  assert.deepEqual(races.map((r) => r.status).sort(), [201, 403]);
  const gallery = await expectStatus(a(path + "/photos"), 200);
  assert.equal(gallery.photos.length, 2);
  assert.equal(gallery.canSearch, false);
  assert.equal(gallery.canUpload, false);
  assert.equal(gallery.photos[0].source.creator, "Fixture author");
  assert.ok(
    gallery.photos.every((p) => p.url.startsWith("/api/components/media/")),
  );
  await expectStatus(a(path + "/photo-search", "POST", {}), 403);
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [ids[1]]);
  const admin = await expectStatus(a(path + "/photo-search", "POST", {}), 200);
  await expectStatus(
    a(path + "/photos/import", "POST", {
      ids: [admin.photos[0].id],
      confirmed: true,
    }),
    201,
  );
  await expectStatus(
    a(path + "/photos/import", "POST", {
      ids: [admin.photos[0].id],
      confirmed: true,
    }),
    404,
  );
  assert.equal(
    (
      await expectStatus(
        a("components/" + model("NoPhotos") + "/photo-search", "POST", {}),
        200,
      )
    ).photos.length,
    0,
  );
  await expectStatus(
    a("components/" + model("UpstreamError") + "/photo-search", "POST", {}),
    503,
  );
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [ids[1]]);
  await expectStatus(a(other + "/photo-search", "POST", {}), 401);
  await expectStatus(
    a(path + "/photos/import", "POST", {
      ids: [admin.photos[1].id],
      confirmed: true,
    }),
    401,
  );
  console.log(
    "Component photo search HTTP: ownership, origin, previews, atomic first-gallery race, provenance, admin, empty/upstream error and blocked accounts passed.",
  );
} finally {
  await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  await db.end();
}
