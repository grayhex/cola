import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gpx, loop } from "./ride-fixtures.js";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
function client() {
  let cookie = "";
  return async (path, method = "GET", body, origin = base) => {
    const bytes = Buffer.isBuffer(body);
    const r = await fetch(base + "/api/" + path, {
      method,
      headers: {
        cookie,
        origin,
        "Content-Type": bytes ? "application/octet-stream" : "application/json",
      },
      body: body ? (bytes ? body : JSON.stringify(body)) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, body: await r.json() };
  };
}
const a = client(),
  b = client(),
  guest = client(),
  nonce = randomUUID().slice(0, 8);
for (const [i, c] of [a, b].entries())
  assert.equal(
    (
      await c("auth/register", "POST", {
      ...testConsents,
        name: "Ride " + i,
        email: `rides-${nonce}-${i}@example.test`,
        password: "ride-test-secret-123",
      })
    ).status,
    201,
  );
const bike = {
  name: "Giant Tourer GTS",
  brand: "Giant",
  model: "Tourer GTS",
  year: 2024,
  category: "road",
  description: "",
  color: "",
  size: "",
  weight: null,
  is_public: true,
};
const bikeId = (await a("bikes", "POST", bike)).body.id;
assert.ok(bikeId);
assert.equal((await guest("rides/preview", "POST", gpx([loop]))).status, 401);
assert.equal(
  (await a("rides/preview", "POST", gpx([loop]), "https://evil.test")).status,
  403,
);
assert.equal(
  (await a("rides/preview", "POST", Buffer.from("<!DOCTYPE gpx><gpx/>")))
    .status,
  400,
);
const p = await a("rides/preview", "POST", gpx([loop]));
assert.equal(p.status, 201, JSON.stringify(p.body));
const input = {
  previewId: p.body.previewId,
  bikeId,
  title: "HTTP ride",
  description: "Test",
  isPublic: true,
  privacyEnabled: true,
  privacyRadiusM: 500,
};
const bBike = (await b("bikes", "POST", bike)).body.id;
assert.equal(
  (await b("rides", "POST", { ...input, bikeId: bBike })).status,
  404,
);
const save = await a("rides", "POST", input);
assert.equal(save.status, 201, JSON.stringify(save.body));
const { id, shareId } = save.body;
assert.equal((await a("rides/preview", "POST", gpx([loop]))).status, 409);
const detail = (await guest("rides/public/" + shareId)).body.ride;
assert.ok(detail.geometry.length);
for (const key of [
  "source_hash",
  "started_at",
  "startedAt",
  "sourceHash",
  "original",
  "privateGeometry",
])
  assert.ok(!(key in detail));
assert.equal((await b("rides/" + id + "/like", "PUT")).status, 200);
assert.equal((await b("rides/" + id + "/like", "PUT")).body.likes, 1);
assert.equal(
  (await b("rides/" + id + "/comments", "POST", { body: "Хорошая покатушка" }))
    .status,
  201,
);
assert.equal((await a("bikes/" + bikeId, "DELETE")).status, 409);
assert.equal(
  (await a("bikes/" + bikeId, "PATCH", { ...bike, is_public: false })).status,
  200,
);
assert.equal((await guest("rides/public/" + shareId)).status, 404);
assert.equal((await guest("rides/" + id + "/comments")).status, 404);
assert.equal((await b("rides/" + id, "DELETE")).status, 404);
assert.equal((await a("rides/" + id, "DELETE")).status, 200);
console.log(
  "Rides HTTP: preview ownership, XML, privacy, social, visibility and delete guard passed",
);
