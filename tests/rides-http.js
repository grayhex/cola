import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gpx, fit, tcx, loop } from "./ride-fixtures.js";
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

// FIT and TCX use the same pipeline (#81). The owner gets the sensors; the
// public sees only the metrics the owner chose, never heart rate by default.
const fitPreview = await b("rides/preview", "POST", fit(loop));
assert.equal(fitPreview.status, 201, JSON.stringify(fitPreview.body));
assert.equal(fitPreview.body.metrics.distanceM, p.body.metrics.distanceM);
assert.equal(fitPreview.body.metrics.avgHr, 110);
const fitRide = {
  bikeId: bBike,
  title: "FIT ride",
  description: "",
  isPublic: true,
  privacyEnabled: false,
  privacyRadiusM: 500,
};
const fitSave = await b("rides", "POST", {
  ...fitRide,
  previewId: fitPreview.body.previewId,
});
assert.equal(fitSave.status, 201, JSON.stringify(fitSave.body));
const publicFit = async () =>
  (await guest("rides/public/" + fitSave.body.shareId)).body.ride;
let shown = await publicFit();
assert.equal(shown.metrics.distanceM, p.body.metrics.distanceM);
assert.equal(shown.speedProfile.length > 0, true);
for (const key of ["avgHr", "maxHr", "avgPower", "maxPower", "avgCadence"])
  assert.ok(!(key in shown.metrics), key);
const ownFit = (await b("rides/owner/" + fitSave.body.shareId)).body.ride;
assert.equal(ownFit.metrics.maxPower, 250);
assert.equal(ownFit.metrics.avgHr, 110);
// Editing re-reads the stored FIT original; showing heart rate is opt-in.
assert.equal(
  (
    await b("rides/" + fitSave.body.id, "PATCH", {
      ...fitRide,
      visibleMetrics: ["distanceM", "movingTimeS", "avgHr"],
    })
  ).status,
  200,
);
shown = await publicFit();
assert.equal(shown.metrics.avgHr, 110);
assert.ok(!("maxPower" in shown.metrics));
// The same file is the same ride; a damaged one gets a clear error.
assert.equal((await b("rides/preview", "POST", fit(loop))).status, 409);
const damaged = Buffer.from(fit(loop));
damaged[200] ^= 0xff;
const rejected = await b("rides/preview", "POST", damaged);
assert.equal(rejected.status, 400);
assert.match(rejected.body.error, /контрольная сумма/);
const tcxPreview = await b("rides/preview", "POST", tcx(loop));
assert.equal(tcxPreview.status, 201, JSON.stringify(tcxPreview.body));
assert.equal(tcxPreview.body.metrics.maxHr, 120);
console.log(
  "Rides HTTP: preview ownership, XML, privacy, social, visibility, delete guard, FIT/TCX import and private sensors passed",
);
