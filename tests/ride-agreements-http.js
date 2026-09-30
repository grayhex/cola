// #235 over HTTP: sessions, same-origin writes, schemas, owner-only tools,
// closed recruitment, a single cancelled date, and what SSR/OG may carry.
import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { publicPath } from "../lib/public-urls.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const nonce = randomUUID().slice(0, 8);
function client() {
  let cookie = "";
  const call = async (path, method = "GET", body, origin = base) => {
    const r = await fetch(base + "/api/" + path, {
      method,
      headers: {
        cookie,
        origin,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    const text = await r.text();
    return {
      status: r.status,
      cache: r.headers.get("cache-control"),
      text,
      body: text.startsWith("{") ? JSON.parse(text) : null,
    };
  };
  call.page = async (path) => {
    const r = await globalThis.fetch(base + path, { headers: { cookie } });
    return { status: r.status, text: await r.text() };
  };
  return call;
}
const organizer = client(),
  rider = client(),
  stranger = client(),
  guest = client();
const names = ["Организатор", "Участник", "Посторонний"];
for (const [i, c] of [organizer, rider, stranger].entries())
  assert.equal(
    (
      await c("auth/register", "POST", {
        ...testConsents,
        name: names[i] + " " + nonce,
        email: `agreements-${nonce}-${i}@example.test`,
        password: "agreements-http-secret-123",
      })
    ).status,
    201,
  );
const riderMe = (await rider("me")).body.user;
const bikeId = (
  await organizer("bikes", "POST", {
    name: "Agreements bike",
    brand: "Giant",
    model: "Revolt",
    year: 2026,
    category: "gravel",
    description: "",
    color: "",
    size: "",
    weight: null,
    is_public: true,
  })
).body.id;
assert.ok(bikeId);
const secret = "Точка сбора " + nonce;
const start = new Date(
  Math.ceil((Date.now() + 50 * 3600000) / 60000) * 60000,
).toISOString();
const planBody = {
  bikeId,
  title: "HTTP договорённости " + nonce,
  description: "",
  isPublic: true,
  privacyEnabled: false,
  privacyRadiusM: 500,
  scheduledAt: start,
  recurrence: "weekly",
  recurrenceTimezone: "Europe/Moscow",
  meetingPoint: secret,
  meetingVisibility: "participants",
  passport: { area: { label: "Район " + nonce }, pace: "relaxed" },
};
const created = await organizer("rides/plan", "POST", planBody);
assert.equal(created.status, 201, created.text);
const { id, shareId } = created.body;
const own = async () => (await organizer("rides/owner/" + shareId)).body.ride;
const ride = await own();
const at = ride.scheduledAt;
assert.equal(+new Date(at), +new Date(start));

// Answers: session, origin, schema, the organizer's own plan.
const rsvp = (c, response, occurrenceAt = at, origin) =>
  c(`rides/${id}/rsvp`, "PATCH", { response, occurrenceAt }, origin);
assert.equal((await rsvp(guest, "accepted")).status, 401);
assert.equal(
  (await rsvp(rider, "accepted", at, "https://evil.test")).status,
  403,
);
for (const body of [
  { response: "going", occurrenceAt: at },
  { response: "accepted" },
  { response: "accepted", occurrenceAt: at, extra: true },
])
  assert.equal(
    (await rider(`rides/${id}/rsvp`, "PATCH", body)).status,
    400,
    JSON.stringify(body),
  );
assert.equal((await rsvp(organizer, "accepted")).status, 409);
const first = await rsvp(rider, "accepted");
assert.equal(first.status, 200, first.text);
assert.equal(first.cache, "no-store");
assert.deepEqual(first.body.rsvpCounts, { accepted: 1 });
// Repeating the same answer changes nothing.
assert.deepEqual((await rsvp(rider, "accepted")).body.rsvpCounts, {
  accepted: 1,
});
let seen = (await rider("rides/public/" + shareId)).body.ride;
assert.equal(seen.participation, "accepted");
assert.equal(seen.meetingPoint, secret);
assert.equal(seen.answers, undefined);
assert.deepEqual(seen.invitations, []);
const organizerView = await own();
assert.equal(organizerView.answers.people[0].author.id, riderMe.id);
assert.doesNotMatch(JSON.stringify(organizerView), /@example\.test/);

// Recruitment: owner only, current date only, strict body.
const recruitment = (c, body, origin) =>
  c(`rides/${id}/recruitment`, "PATCH", body, origin);
assert.equal(
  (await recruitment(guest, { open: false, occurrenceAt: at })).status,
  401,
);
assert.equal(
  (await recruitment(rider, { open: false, occurrenceAt: at })).status,
  404,
);
assert.equal(
  (
    await recruitment(
      organizer,
      { open: false, occurrenceAt: at },
      "https://evil.test",
    )
  ).status,
  403,
);
assert.equal((await recruitment(organizer, { open: false })).status, 400);
assert.equal(
  (
    await recruitment(organizer, {
      open: false,
      occurrenceAt: new Date(+new Date(at) + 3600000).toISOString(),
    })
  ).status,
  409,
);
assert.equal(
  (await recruitment(organizer, { open: false, occurrenceAt: at })).status,
  200,
);
assert.equal((await rsvp(stranger, "accepted")).status, 409);
assert.equal((await rsvp(stranger, "declined")).status, 200);
assert.equal((await rsvp(rider, "maybe")).status, 200);
seen = (await stranger("rides/public/" + shareId)).body.ride;
assert.equal(seen.recruitmentClosed, true);
assert.equal(seen.canJoin, false);
assert.equal(
  (await recruitment(organizer, { open: true, occurrenceAt: at })).status,
  200,
);
assert.equal((await rsvp(stranger, "accepted")).status, 200);

// The public announcement: date, zone, area and organizer; never the place,
// people or answers — in the HTML, the metadata and the list API.
const path = publicPath("ride", organizerView);
const html = await guest.page(path);
assert.equal(html.status, 200);
assert.match(html.text, /og:description[^>]*GMT\+3/);
assert.match(html.text, new RegExp("og:description[^>]*Район " + nonce));
assert.match(html.text, new RegExp("организатор: Организатор " + nonce));
for (const hidden of [secret, "Участник " + nonce, "Посторонний " + nonce])
  assert.ok(!html.text.includes(hidden), hidden);
const listed = await guest("rides?status=planned");
assert.ok(!listed.text.includes(secret));
assert.ok(!listed.text.includes("Участник " + nonce));

// One date of the series: owner only, strict body; `{}` and no body cancel
// the whole plan as before.
const cancel = (c, body, origin) =>
  c(`rides/${id}/cancel`, "POST", body, origin);
assert.equal((await cancel(guest, { occurrenceAt: at })).status, 401);
assert.equal((await cancel(rider, { occurrenceAt: at })).status, 404);
assert.equal(
  (await cancel(organizer, { occurrenceAt: at }, "https://evil.test")).status,
  403,
);
assert.equal((await cancel(organizer, { occurrenceAt: "soon" })).status, 400);
assert.equal(
  (await cancel(organizer, { occurrenceAt: at, scope: "all" })).status,
  400,
);
const skipped = await cancel(organizer, { occurrenceAt: at });
assert.equal(skipped.status, 200, skipped.text);
assert.equal(skipped.body.scope, "occurrence");
const next = (await guest("rides/public/" + shareId)).body.ride;
assert.equal(next.status, "planned");
assert.equal(+new Date(next.scheduledAt) - +new Date(at), 7 * 24 * 3600000);
assert.deepEqual(
  next.cancelledOccurrences.map((d) => +new Date(d)),
  [+new Date(at)],
);
assert.deepEqual(next.rsvpCounts, {});
// The old date is no longer answerable; the new one is.
assert.equal((await rsvp(rider, "accepted", at)).status, 409);
assert.equal((await rsvp(rider, "accepted", next.scheduledAt)).status, 200);
assert.equal((await cancel(organizer, {})).status, 200);
assert.equal(
  (await guest("rides/public/" + shareId)).body.ride.status,
  "cancelled",
);
assert.match(
  (await guest.page(path)).text,
  /og:description[^>]*Покатушка отменена/,
);

// A closed plan: a 404 for everyone but invited people, no preview image.
const closed = await organizer("rides/plan", "POST", {
  ...planBody,
  recurrence: "none",
  isPublic: false,
  title: "Закрытый план " + nonce,
  invitations: [riderMe.username],
});
assert.equal(closed.status, 201, closed.text);
const closedRide = (await organizer("rides/owner/" + closed.body.shareId)).body
  .ride;
const closedPath = publicPath("ride", closedRide);
assert.equal((await guest.page(closedPath)).status, 404);
assert.equal((await stranger.page(closedPath)).status, 404);
assert.ok(
  !(await guest.page(closedPath)).text.includes("Закрытый план " + nonce),
);
assert.equal(
  (await guest(`social-preview/ride/${closedRide.public_id}/image`)).status,
  404,
);
assert.equal(
  (await stranger("rides/public/" + closed.body.shareId)).status,
  404,
);
assert.equal(
  (
    await stranger(`rides/${closed.body.id}/rsvp`, "PATCH", {
      response: "accepted",
      occurrenceAt: closedRide.scheduledAt,
    })
  ).status,
  404,
);
const invited = await rider.page(closedPath);
assert.equal(invited.status, 200);
assert.ok(invited.text.includes("Закрытый план " + nonce));
// Neutral metadata even for the invited reader's page.
assert.match(invited.text, /<title>ColaBike<\/title>/);
console.log(
  "Ride agreements HTTP: sessions, origin, schemas, one state, closed recruitment, a cancelled date, neutral private previews passed",
);
