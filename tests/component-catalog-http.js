import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const nonce = randomUUID().slice(0, 8),
  term = "Brooks Catalog " + nonce;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
function client() {
  let cookie = "";
  return async (path, method = "GET", data, origin = base) => {
    const r = await fetch(base + "/api/" + path, {
      method,
      headers: { origin, cookie, "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, body: await r.json() };
  };
}
const owner = client(),
  guest = client(),
  admin = client();
const register = (api, label) =>
  api("auth/register", "POST", {
    ...testConsents,
    name: label + nonce,
    email: `${label}-${nonce}@example.test`,
    password: "catalog-http-secret-123",
  });
let ownerId, adminId;
try {
  ownerId = (await register(owner, "catalog-owner")).body.user.id;
  adminId = (await register(admin, "catalog-admin")).body.user.id;
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [adminId]);
  const baseBike = {
    name: "Catalog bike " + nonce,
    brand: "Cube",
    model: "Travel",
    year: 2024,
    category: "road",
    is_public: true,
    description: "",
    color: "",
    size: "",
    weight: null,
  };
  const created = await owner("bikes/wizard", "POST", {
    requestId: randomUUID(),
    bike: baseBike,
    components: Array.from({ length: 27 }, (_, n) => ({
      section: "build",
      category: "Седло",
      name: term + " " + n,
      notes: "",
      price: null,
    })),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const bikeId = created.body.id;
  const privateBike = (
    await owner("bikes", "POST", { ...baseBike, is_public: false })
  ).body.id;
  assert.equal(
    (
      await owner(`bikes/${privateBike}/components`, "POST", {
        section: "build",
        category: "Седло",
        name: term + " PRIVATE",
        notes: "",
        price: null,
      })
    ).status,
    201,
  );
  const list = async (extra = {}) => {
    const r = await guest(
      "components?" + new URLSearchParams({ q: term, ...extra }),
    );
    assert.equal(r.status, 200);
    return r.body;
  };
  const first = await list(),
    second = await list({ page: "2" });
  assert.equal(first.total, 27);
  assert.equal(first.items.length, 24);
  assert.equal(second.items.length, 3);
  assert.equal(
    new Set([...first.items, ...second.items].map((m) => m.id)).size,
    27,
  );
  assert.deepEqual(await list(), first);
  assert.equal((await list({ brand: "Brooks", category: "Седло" })).total, 27);
  assert.equal((await list({ brand: "Shimano" })).total, 0);
  assert.equal((await guest("components?page=-1")).status, 400);
  assert.equal((await guest("components?sort=arbitrary")).status, 400);
  assert.equal((await list({ sort: "new" })).total, 27);
  const html = await (
    await fetch(
      base + "/components?" + new URLSearchParams({ q: term, page: "2" }),
    )
  ).text();
  assert(html.includes(second.items[0].name));
  assert(!html.includes(term + " PRIVATE"));
  const model = first.items[0];
  const adminList = async () =>
    (
      await admin(
        "admin/component-models?" + new URLSearchParams({ q: model.name }),
      )
    ).body;
  const editable = (await adminList()).items.find((m) => m.id === model.id);
  const edit = {
    name: term + " Renamed",
    brand: "Brooks",
    category: "Седло",
    archived: false,
    version: editable.version,
  };
  assert.equal((await guest("admin/component-models")).status, 401);
  assert.equal(
    (await owner("admin/component-models/" + model.id, "PATCH", edit)).status,
    403,
  );
  assert.equal(
    (
      await admin(
        "admin/component-models/" + model.id,
        "PATCH",
        edit,
        "https://evil.example",
      )
    ).status,
    403,
  );
  const competing = await Promise.all([
    admin("admin/component-models/" + model.id, "PATCH", edit),
    admin("admin/component-models/" + model.id, "PATCH", edit),
  ]);
  assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
  const renamed = competing.find((r) => r.status === 200).body;
  const moved = await fetch(base + model.path, { redirect: "manual" });
  assert.equal(moved.status, 308);
  assert.equal(moved.headers.get("location"), renamed.path);
  const stable = await fetch(base + "/components/" + model.id, {
    redirect: "manual",
  });
  assert.equal(stable.status, 308);
  assert.equal(stable.headers.get("location"), renamed.path);
  const target = (
    await admin("admin/component-models?" + new URLSearchParams({ q: term }))
  ).body.items.find((m) => m.id !== model.id);
  const merged = await admin(
    `admin/component-models/${model.id}/merge`,
    "POST",
    { targetId: target.id, version: 2, targetVersion: target.version },
  );
  assert.equal(merged.status, 200);
  assert.equal(
    (await fetch(base + model.path, { redirect: "manual" })).headers.get(
      "location",
    ),
    target.path,
  );
  const bikeData = (await owner("bikes/" + bikeId)).body.bike;
  assert(
    bikeData.components.some((p) => p.model_id === model.id),
    "merge retains installation foreign IDs",
  );
  assert.equal(
    (await owner(`bikes/${bikeId}/share`, "PATCH", { is_public: false }))
      .status,
    200,
  );
  assert((await list()).items.every((m) => m.builds === 0));
  assert.equal((await fetch(base + target.path)).status, 200);
  assert.equal((await owner("bikes/" + bikeId, "DELETE")).status, 200);
  const page = await fetch(base + target.path);
  assert.equal(page.status, 200);
  assert((await page.text()).includes("Пока нет публичных сборок"));
  // Exact same new identity created concurrently on different owners' bikes.
  const adminBike = (await admin("bikes", "POST", baseBike)).body.id;
  const duplicate = {
    section: "build",
    category: "Седло",
    name: term + " concurrent",
    notes: "",
    price: null,
  };
  const writes = await Promise.all([
    owner(`bikes/${privateBike}/components`, "POST", duplicate),
    admin(`bikes/${adminBike}/components`, "POST", duplicate),
  ]);
  assert(writes.every((r) => r.status === 201));
  const ids = [];
  for (const [api, id] of [
    [owner, privateBike],
    [admin, adminBike],
  ])
    ids.push(
      (await api("bikes/" + id)).body.bike.components.find(
        (p) => p.name === duplicate.name,
      ).model_id,
    );
  assert.equal(ids[0], ids[1]);
  console.log(
    "Component catalog HTTP: filters, pagination, SSR, privacy, authorization/CSRF, concurrent identity/version checks, rename/merge redirects and durable pages passed.",
  );
} finally {
  for (const id of [ownerId, adminId].filter(Boolean))
    await db.query("DELETE FROM users WHERE id=$1", [id]);
  await db.end();
}
