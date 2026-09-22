import { testConsents } from "./fixtures/legal.js";
// Disposable integration DB and fixture resolver only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.TEST_ORIGIN;
function client() {
  let cookie = "";
  return async (path, method = "GET", data) => {
    const r = await fetch(base + "/api/" + path, {
      method,
      headers: { origin: base, cookie, "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return {
      status: r.status,
      data: r.headers.get("content-type")?.includes("json")
        ? await r.json()
        : Buffer.from(await r.arrayBuffer()),
    };
  };
}
const a = client(),
  b = client();
for (const api of [a, b])
  assert.equal(
    (
      await api("auth/register", "POST", {
      ...testConsents,
        email: randomUUID() + "@example.test",
        name: "Layout",
        password: "layout-tests-12345",
      })
    ).status,
    201,
  );
const query = { brand: "Giant", model: "Tourer", trim: "GTS", year: 2024 };
const sourceUrl = "https://www.velo-port.ru/test-bike";
const input = {
  ...query,
  name: "Giant Tourer",
  category: "road",
  description: "",
  color: "",
  size: "",
  weight: null,
  manufacturer_url: "https://www.giant-bicycles.com/",
  price: 50000,
  show_bike_price: false,
  show_component_prices: false,
  show_accessory_prices: true,
};
const create = await a("bikes", "POST", input);
assert.equal(create.status, 201);
const id = create.data.id;
const resolve = await a("bikes/resolve", "POST", { ...query, sourceUrl });
assert.equal(resolve.data.status, "resolved");
assert.equal(resolve.data.manualSelection, true);
assert.equal(
  (
    await a("bikes/" + id + "/factory-spec", "POST", {
      sourceUrl,
      initializeCurrent: true,
    })
  ).data.importedCount,
  3,
);
let bike = (await a("bikes/" + id)).data.bike;
const ids = bike.components.map((c) => c.id).reverse();
assert.equal(
  (
    await a("bikes/" + id + "/order", "PUT", {
      components: ids,
      groups: ["brakes", "frame"],
    })
  ).status,
  200,
);
assert.equal(
  (await b("bikes/" + id + "/order", "PUT", { components: ids })).status,
  404,
);
assert.equal(
  (await a("bikes/" + id + "/order", "PUT", { components: ids.slice(1) }))
    .status,
  409,
);
bike = (await a("bikes/" + id)).data.bike;
assert.deepEqual(
  bike.components.map((c) => c.id),
  ids,
);
assert.deepEqual(bike.group_order, ["brakes", "frame"]);
assert.equal(
  (
    await a("bikes/" + id + "/components/" + ids[0], "PATCH", {
      price: 1000,
      url: "https://example.com/brake",
      group_id: "brakes",
    })
  ).status,
  200,
);
const photoSearch = await a("bikes/photo-search", "POST", {
  ...query,
  sourceUrl,
});
assert.equal(photoSearch.status, 200);
const token = photoSearch.data.photos[0].id;
assert.equal((await b("bikes/photo-candidates/" + token)).status, 404);
assert.equal((await a("bikes/photo-candidates/" + token)).status, 200);
assert.equal(
  (await a("bikes/" + id + "/photos/import", "POST", { ids: [token] })).status,
  201,
);
assert.equal(
  (await a("bikes/" + id + "/photos/import", "POST", { ids: [token] })).status,
  400,
);
bike = (await a("bikes/" + id)).data.bike;
assert.equal(bike.photos.length, 1);
assert(bike.photos[0].is_cover);
assert.equal(bike.photos[0].source_page_url, sourceUrl);
const version = await a("versions");
assert.equal(version.data.app.version, "0.3.1");
assert.equal(version.data.resolver.version, "2.0.0");
await a("bikes/" + id, "DELETE");
console.log(
  "Layout HTTP integration: URL import, persisted order, ownership, partial edits, image token ownership, download, duplicate rollback and versions passed.",
);
