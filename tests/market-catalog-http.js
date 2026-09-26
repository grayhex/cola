import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
const base = process.env.TEST_ORIGIN || "http://localhost:3100",
  nonce = randomUUID().slice(0, 8);
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
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
}
const owner = client(),
  other = client(),
  admin = client(),
  guest = client(),
  users = [];
const register = async (api, label) => {
  const r = await api("auth/register", "POST", {
    ...testConsents,
    name: label + nonce,
    email: `${label}-${nonce}@example.test`,
    password: "market-catalog-http-123",
  });
  assert.equal(r.status, 201);
  users.push(r.body.user.id);
  return r.body.user.id;
};
const bikeInput = {
  name: "Model build " + nonce,
  brand: "MarketBrand" + nonce,
  model: "Catalog Model",
  year: 2024,
  category: "road",
  is_public: true,
  description: "",
  color: "",
  size: "",
  weight: null,
};
const offer = {
  title: "Independent advert " + nonce,
  description: "Description of the actual item",
  category: "bikes",
  condition: "used",
  price: 4500,
  location: "City",
  contact: "PRIVATE CONTACT " + nonce,
  status: "active",
};
try {
  const ownerId = await register(owner, "market-link-owner");
  await register(other, "market-link-other");
  const adminId = await register(admin, "market-link-admin");
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [adminId]);
  const created = await owner("bikes/wizard", "POST", {
    requestId: randomUUID(),
    bike: bikeInput,
    components: [
      {
        section: "build",
        category: "Седло",
        name: "Brooks Market " + nonce,
        notes: "",
        price: null,
      },
    ],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const bikeId = created.body.id,
    bike = (await owner("bikes/" + bikeId)).body.bike,
    modelId = bike.catalog_model_id,
    componentId = bike.components[0].model_id;
  const privateBike = (
    await owner("bikes", "POST", {
      ...bikeInput,
      name: "SECRET NAME " + nonce,
      model: "SECRET MODEL " + nonce,
      is_public: false,
    })
  ).body;
  const foreign = (await other("bikes", "POST", bikeInput)).body;
  assert.equal((await guest("market/owned-bikes")).status, 401);
  assert(
    (await owner("market/owned-bikes")).body.items.some(
      (b) => b.id === privateBike.id,
    ),
  );
  assert(
    !(await other("market/owned-bikes")).body.items.some(
      (b) => b.id === privateBike.id,
    ),
  );
  const choices = (
    await guest(
      "market/models?" +
        new URLSearchParams({ category: "bikes", q: bikeInput.brand }),
    )
  ).body;
  assert(choices.items.some((m) => m.id === modelId));
  assert(!JSON.stringify(choices).includes("SECRET"));
  const component = (
    await guest(
      "market/models?" +
        new URLSearchParams({
          category: "components",
          q: "Brooks Market " + nonce,
        }),
    )
  ).body.items[0];
  assert.equal(component.id, componentId);
  const linked = {
    ...offer,
    bikeModelId: modelId,
    linkedBikeId: privateBike.id,
  };
  assert.equal((await guest("market", "POST", linked)).status, 401);
  assert.equal(
    (await owner("market", "POST", linked, "https://evil.example")).status,
    403,
  );
  assert.equal(
    (await owner("market", "POST", { ...linked, linkedBikeId: foreign.id }))
      .status,
    404,
  );
  assert.equal(
    (await owner("market", "POST", { ...linked, bikeModelId: componentId }))
      .status,
    404,
  );
  assert.equal(
    (await owner("market", "POST", { ...linked, bikeModelId: "broken" }))
      .status,
    400,
  );
  const hiddenModel = (await owner("bikes/" + privateBike.id)).body.bike
    .catalog_model_id;
  assert.equal(
    (await owner("market", "POST", { ...linked, bikeModelId: hiddenModel }))
      .status,
    404,
  );
  assert.equal((await fetch(base + "/bike-models/" + hiddenModel)).status, 404);
  const made = await owner("market", "POST", linked);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const listing = made.body;
  assert.equal(
    (await other("market/" + listing.id, "PATCH", linked)).status,
    404,
  );
  const read = async (api = guest) =>
    (await api("market/public/" + listing.shareId)).body.listing;
  assert.equal((await read(owner)).linkedBikeId, privateBike.id);
  const publicData = await read();
  assert.equal(publicData.linkedBike, null);
  assert.equal(publicData.bikeModel.id, modelId);
  const html = await (await fetch(base + "/market/" + listing.shareId)).text();
  for (const secret of [
    privateBike.id,
    "SECRET NAME " + nonce,
    "SECRET MODEL " + nonce,
    offer.contact,
  ]) {
    assert(!JSON.stringify(publicData).includes(secret));
    assert(!html.includes(secret));
  }
  assert(html.includes(offer.title));
  assert(html.includes(publicData.bikeModel.path));
  assert.equal(
    (
      await owner("market/" + listing.id, "PATCH", {
        ...offer,
        linkedBikeId: bikeId,
      })
    ).status,
    200,
  );
  assert.equal((await read()).linkedBike.id, bikeId);
  assert.equal(
    (
      await owner("bikes/" + bikeId, "PATCH", {
        ...bikeInput,
        is_public: false,
      })
    ).status,
    200,
  );
  assert.equal((await read()).linkedBike, null);
  // Same catalog permissions/version guard as components, tested over HTTP.
  const editable = (
    await admin(
      "admin/bike-models?" + new URLSearchParams({ q: bikeInput.brand }),
    )
  ).body.items.find((m) => m.id === modelId);
  const edit = {
    brand: bikeInput.brand,
    name: "Renamed Model",
    archived: false,
    version: editable.version,
  };
  assert.equal(
    (await owner("admin/bike-models/" + modelId, "PATCH", edit)).status,
    403,
  );
  assert.equal(
    (
      await admin(
        "admin/bike-models/" + modelId,
        "PATCH",
        edit,
        "https://evil.example",
      )
    ).status,
    403,
  );
  const changes = await Promise.all([
    admin("admin/bike-models/" + modelId, "PATCH", edit),
    admin("admin/bike-models/" + modelId, "PATCH", edit),
  ]);
  assert.deepEqual(changes.map((r) => r.status).sort(), [200, 409]);
  const renamed = changes.find((r) => r.status === 200).body;
  for (const path of [editable.path, "/bike-models/" + modelId]) {
    const r = await fetch(base + path, { redirect: "manual" });
    assert.equal(r.status, 308);
    assert.equal(r.headers.get("location"), renamed.path);
  }
  const newData = await read();
  assert.equal(newData.title, offer.title);
  assert.equal(newData.description, offer.description);
  assert.equal(Number(newData.price), offer.price);
  assert.equal(newData.bikeModel.path, renamed.path);
  // Distinct names whose slugs collide have usable pages, never a redirect loop.
  const variants = [];
  for (const model of ["Variant+X", "Variant X"]) {
    const madeBike = await owner("bikes", "POST", { ...bikeInput, model });
    assert.equal(madeBike.status, 201);
    const value = (await owner("bikes/" + madeBike.body.id)).body.bike;
    const r = await fetch(base + "/bike-models/" + value.catalog_model_id, {
      redirect: "manual",
    });
    assert.equal(r.status, 308);
    const path = r.headers.get("location");
    assert.equal(
      (await fetch(base + path, { redirect: "manual" })).status,
      200,
    );
    variants.push({ id: value.catalog_model_id, path });
  }
  assert.notEqual(variants[0].path, variants[1].path);
  const merge = await admin("admin/bike-models/" + modelId + "/merge", "POST", {
    targetId: variants[1].id,
    version: 2,
    targetVersion: 1,
  });
  assert.equal(merge.status, 200);
  assert.equal((await read()).bikeModel.id, variants[1].id);
  assert.equal(
    (await fetch(base + editable.path, { redirect: "manual" })).headers.get(
      "location",
    ),
    variants[1].path,
  );

  assert.equal(
    (
      await owner("market/" + listing.id, "PATCH", {
        ...offer,
        category: "components",
        componentModelId: componentId,
      })
    ).status,
    200,
  );
  const componentOffer = await read();
  assert.equal(componentOffer.bikeModel, null);
  assert.equal(componentOffer.componentModel.id, componentId);
  assert.equal(
    (await other("market/" + listing.id + "/save", "PUT")).status,
    200,
  );
  assert.equal((await owner("bikes/" + bikeId, "DELETE")).status, 200);
  assert.equal((await read(owner)).linkedBikeId, null);
  assert.equal((await read()).componentModel.id, componentId);
  assert.equal(
    (
      await owner("market/" + listing.id, "PATCH", {
        ...offer,
        category: "components",
        status: "sold",
      })
    ).status,
    200,
  );
  assert.equal((await read()).status, "sold");
  assert.equal(
    (await other("market/public/" + listing.shareId + "/contact")).status,
    404,
  );
  const soldHtml = await (
    await fetch(base + "/market/" + listing.shareId)
  ).text();
  assert(soldHtml.includes("noindex"));
  const manual = await owner("market", "POST", offer);
  assert.equal(manual.status, 201);
  assert.equal(
    (await guest("market/public/" + manual.body.shareId)).body.listing
      .bikeModel,
    null,
  );
  assert.equal(
    (
      await owner("market/" + manual.body.id, "PATCH", {
        ...offer,
        bikeModelId: modelId,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await owner("market/" + manual.body.id, "PATCH", {
        ...offer,
        bikeModelId: null,
      })
    ).status,
    200,
  );
  // Re-read on every request, including a stale session after blocking.
  await db.query("UPDATE users SET blocked=true WHERE id=$1", [ownerId]);
  assert.equal((await owner("market/owned-bikes")).status, 401);
  assert.equal((await guest("market/public/" + listing.shareId)).status, 404);
  console.log(
    "market catalog HTTP: models, own/private/foreign links, Origin, IDOR, rename, deletion, SSR privacy and legacy contracts passed",
  );
} finally {
  await db.query("DELETE FROM users WHERE id=ANY($1)", [users]);
  await db.end();
}
