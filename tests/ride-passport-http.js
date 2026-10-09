import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { publicPath } from "../lib/public-urls.ts";
import { gpx, loop } from "./ride-fixtures.js";

// Moved from tests/e2e/ride-passport.spec.js (#386): this check never touched a
// page or a browser — only request clients and the SSR HTML — so it runs once,
// here, instead of once per browser. Every assertion of the old test is kept:
// sessions, Origin, schemas, the private meeting point and the geometry for a
// guest, the API list, the page and the preview, and what an accepted and a
// declined rider is shown.
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
function client() {
  let cookie = "";
  return async (
    path,
    { method = "GET", body, headers = {}, origin = base } = {},
  ) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { cookie } : {}), origin, ...headers },
      body,
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    const text = await response.text();
    return { status: response.status, text, json: () => JSON.parse(text) };
  };
}
const json = (data) => ({
  body: JSON.stringify(data),
  headers: { "content-type": "application/json" },
});
const guest = client(),
  author = client(),
  reader = client(),
  nonce = randomUUID().slice(0, 8);
const secret = "Закрытая встреча у входа 17";
const plannedAt = "2031-03-29T09:00:00Z";
for (const [i, who] of [author, reader].entries())
  assert.equal(
    (
      await who("/api/auth/register", {
        method: "POST",
        ...json({
          ...testConsents,
          name: "Passport Rider",
          email: `passport-${nonce}-${i}@example.test`,
          password: "passport-http-secret-123",
        }),
      })
    ).status,
    201,
  );
const created = await author("/api/bikes", {
  method: "POST",
  ...json({
    name: "Passport gravel",
    brand: "Giant",
    model: "Revolt",
    year: 2026,
    category: "gravel",
    description: "",
    color: "",
    size: "M",
    weight: 9,
    is_public: true,
  }),
});
assert.equal(created.status, 201, created.text);
const bike = created.json();

const input = {
  bikeId: bike.id,
  title: "HTTP passport",
  description: "Public description",
  isPublic: true,
  privacyEnabled: false,
  privacyRadiusM: 500,
  scheduledAt: plannedAt,
  meetingPoint: secret,
};
assert.equal(
  (await guest("/api/rides/plan", { method: "POST", ...json(input) })).status,
  401,
);
assert.equal(
  (
    await author("/api/rides/plan", {
      method: "POST",
      origin: "https://evil.test",
      ...json(input),
    })
  ).status,
  403,
);
for (const fields of [
  { passport: { surprise: true } },
  { passport: { distanceKm: { min: 40, max: 20 } } },
  { expectedEndAt: "2031-03-29T08:00:00Z" },
])
  assert.equal(
    (
      await author("/api/rides/plan", {
        method: "POST",
        ...json({ ...input, ...fields }),
      })
    ).status,
    400,
    JSON.stringify(fields),
  );
const planned = await author("/api/rides/plan", {
  method: "POST",
  ...json(input),
});
assert.equal(planned.status, 201, planned.text);
const plan = planned.json();
const track = await author(`/api/rides/${plan.id}/track`, {
  method: "POST",
  headers: { "content-type": "application/gpx+xml" },
  body: gpx([loop]),
});
assert.equal(track.status, 200, track.text);
const data = (await guest("/api/rides/public/" + plan.shareId)).json().ride;
assert.deepEqual(data.passport, {});
assert.equal(data.meetingPoint, "");
assert.equal(
  data.geometry.flat().some((p) => p[0] === loop[0][0] && p[1] === loop[0][1]),
  false,
);
assert.equal(data.analysis, null);
assert.ok(!JSON.stringify(data).includes(secret));
assert.ok(!(await guest(publicPath("ride", data))).text.includes(secret));
assert.ok(!(await guest("/api/rides")).text.includes(secret));
for (const response of ["accepted", "declined"]) {
  assert.equal(
    (
      await reader(`/api/rides/${plan.id}/rsvp`, {
        method: "PATCH",
        ...json({ response, occurrenceAt: plannedAt }),
      })
    ).status,
    200,
  );
  const detail = (await reader("/api/rides/public/" + plan.shareId)).json()
    .ride;
  assert.equal(detail.meetingPoint, response === "accepted" ? secret : "");
  assert.ok(!(await guest(publicPath("ride", data))).text.includes(secret));
}
console.log(
  "PASS: ride passport schemas, sessions, Origin and the private meeting point for a guest, the API list, the page and the preview.",
);
