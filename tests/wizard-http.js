import { testConsents } from "./fixtures/legal.js";
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
    return { status: r.status, data: await r.json() };
  };
}
const a = client(),
  b = client();
for (const api of [a, b])
  await api("auth/register", "POST", {
    ...testConsents,
    name: "Wizard",
    email: randomUUID() + "@example.test",
    password: "wizard-http-password",
  });
const query = { brand: "Giant", model: "Tourer", trim: "GTS", year: 2024 };
const resolved = await a("bikes/resolve", "POST", {
  ...query,
  sourceUrl: "https://www.velo-port.ru/test-bike",
});
assert.equal(resolved.data.status, "resolved");
assert(resolved.data.previewId);
const input = {
  requestId: randomUUID(),
  previewId: resolved.data.previewId,
  bike: {
    ...query,
    name: "Giant Tourer GTS 2024",
    category: "road",
    description: "",
    color: "Black",
    size: "L",
    weight: null,
    mileage: 750,
    is_public: true,
  },
  components: [
    {
      section: "build",
      category: "Седло",
      name: "Edited saddle",
      notes: "",
      price: 5000,
    },
  ],
};
assert.equal((await b("bikes/wizard", "POST", input)).status, 409);
const created = await a("bikes/wizard", "POST", input);
assert.equal(created.status, 201);
const id = created.data.id;
assert.equal((await a("bikes/wizard", "POST", input)).data.id, id);
const bike = (await a("bikes/" + id)).data.bike;
assert.equal(bike.mileage, 750);
assert(bike.is_public);
assert.equal(bike.components.length, 1);
assert.equal(bike.components[0].name, "Edited saddle");
assert.equal(bike.factory_spec.components.length, 3);
const shared = (await b("shared/" + bike.share_id)).data.bike;
assert.equal(shared.mileage, 750);
assert(!("price" in shared.components[0]));
assert.equal(
  (
    await a("bikes/wizard", "POST", {
      ...input,
      requestId: randomUUID(),
      bike: { ...input.bike, mileage: -1 },
    })
  ).status,
  400,
);
assert.equal(
  (
    await a("bikes/wizard", "POST", {
      ...input,
      requestId: randomUUID(),
      bike: { ...input.bike, year: 2025 },
    })
  ).status,
  409,
);
const accepted = await a("bikes/wizard", "POST", {
  ...input,
  requestId: randomUUID(),
  identityConfirmed: true,
  bike: { ...input.bike, year: 2025 },
});
assert.equal(accepted.status, 201);
const confirmedBike = (await a("bikes/" + accepted.data.id)).data.bike;
assert.equal(confirmedBike.year, 2025);
assert.equal(confirmedBike.factory_spec.query.year, 2024);
await a("bikes/" + accepted.data.id, "DELETE");
await a("bikes/" + id, "DELETE");
console.log(
  "Wizard HTTP: preview ownership, edited components vs factory provenance, atomic creation, idempotent retry, mileage, privacy and validation passed.",
);
