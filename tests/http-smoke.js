import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
// Run against an explicitly disposable app/DB: node tests/http-smoke.js
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const base = process.env.TEST_ORIGIN || "http://localhost:3000";
function client() {
  let cookie = "";
  return async (url, method = "GET", data, origin = base) => {
    const response = await fetch(base + "/api/" + url, {
      method,
      headers: {
        origin,
        ...(cookie ? { cookie } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: response.status, body: await response.json(), cookie };
  };
}
const owner = client(),
  stranger = client(),
  anonymous = client();
const nonce = randomUUID();
let bikeId;
try {
  assert.equal((await anonymous("health")).status, 200);
  assert.equal((await anonymous("bikes")).status, 401);
  assert.equal(
    (
      await owner("auth/register", "POST", {
      ...testConsents,
        email: `owner-${nonce}@example.test`,
        name: "Smoke test",
        password: "colabike-test-12345",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await stranger("auth/register", "POST", {
      ...testConsents,
        email: `other-${nonce}@example.test`,
        name: "Other test",
        password: "colabike-test-12345",
      })
    ).status,
    201,
  );
  const b = {
    name: "Smoke bike",
    brand: "Canyon",
    model: "Grizl",
    year: 2025,
    category: "gravel",
    description: "Test",
    size: "M",
    color: "Black",
    weight: 10.5,
  };
  assert.equal(
    (await owner("bikes", "POST", b, "https://untrusted.example")).status,
    403,
  );
  const made = await owner("bikes", "POST", b);
  assert.equal(made.status, 201);
  bikeId = made.body.id;
  assert.equal((await stranger("bikes/" + bikeId)).status, 404);
  assert.equal((await stranger("bikes/" + bikeId, "PATCH", b)).status, 404);
  assert.equal((await stranger("bikes/" + bikeId, "DELETE")).status, 404);
  assert.equal(
    (
      await owner(`bikes/${bikeId}/components`, "POST", {
        section: "build",
        category: "Седло",
        name: "Brooks C17",
        notes: "",
        price: 12345,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await owner(`bikes/${bikeId}/components`, "POST", {
        section: "accessories",
        category: "Велокомпьютер",
        name: "Garmin Edge 540",
        notes: "",
        price: null,
      })
    ).status,
    201,
  );
  const privateBike = (await owner("bikes/" + bikeId)).body.bike;
  assert.equal(privateBike.components.length, 2);
  const { cookie } = await owner("me");
  const bytes = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  const uploaded = await fetch(base + `/api/bikes/${bikeId}/photos`, {
    method: "POST",
    headers: { origin: base, cookie, "Content-Type": "image/png" },
    body: bytes,
  });
  assert.equal(uploaded.status, 201);
  const photo = (await uploaded.json()).id;
  assert.equal((await fetch(base + "/api/photos/" + photo)).status, 404);
  assert.equal(
    (await fetch(base + "/api/photos/" + photo, { headers: { cookie } }))
      .status,
    200,
  );
  assert.equal((await anonymous("shared/" + privateBike.share_id)).status, 404);
  assert.equal(
    (await owner(`bikes/${bikeId}/share`, "PATCH", { is_public: true })).status,
    200,
  );
  const shared = (await anonymous("shared/" + privateBike.share_id)).body.bike;
  assert.equal(shared.components.length, 2);
  assert.ok(shared.components.every((c) => !("price" in c)));
  assert.equal("owner_id" in shared, false);
  assert.equal((await fetch(base + "/api/photos/" + photo)).status, 200);
  assert.equal(
    (await owner(`bikes/${bikeId}/share`, "PATCH", { is_public: false }))
      .status,
    200,
  );
  assert.equal((await anonymous("shared/" + privateBike.share_id)).status, 404);
  assert.equal((await fetch(base + "/api/photos/" + photo)).status, 404);
  assert.equal(
    (await owner("bikes/" + bikeId, "PATCH", { ...b, name: "Updated" })).status,
    200,
  );
  assert.equal((await owner("bikes/" + bikeId)).body.bike.name, "Updated");
  assert.equal(
    (
      await owner(
        `bikes/${bikeId}/components/${privateBike.components[0].id}`,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal((await owner("bikes/" + bikeId)).body.bike.components.length, 1);
  assert.equal((await owner("bikes/" + bikeId, "DELETE")).status, 200);
  bikeId = null;
  await owner("auth/logout", "POST");
  assert.equal((await owner("bikes")).status, 401);
  console.log(
    "PASS: HTTP auth, CSRF, ownership, components, image upload, private/public photos, price privacy, sharing revocation, update, deletion and logout.",
  );
} finally {
  if (bikeId) await owner("bikes/" + bikeId, "DELETE");
}
