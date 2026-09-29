import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { verifiedFetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
// HTTP contract of /api/ride-matches (#232): session, validation, owner-only
// organizer view, no-store, privacy changes visible on the very next read.
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
function client() {
  let cookie = "";
  return async (path, method = "GET", data, origin = base) => {
    const response = await verifiedFetch(base + "/api/" + path, {
      method,
      headers: { cookie, origin, "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      text,
      body: text ? JSON.parse(text) : null,
    };
  };
}
const organizer = client(),
  rider = client(),
  guest = client();
const ids = [];
for (const c of [organizer, rider]) {
  const r = await c("auth/register", "POST", {
    ...testConsents,
    name: "Match HTTP",
    email: randomUUID() + "@example.test",
    password: "match-test-secret-123",
  });
  assert.equal(r.status, 201);
  ids.push(r.body.user.id);
}
const [organizerId, riderId] = ids;
const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const bike = await organizer("bikes", "POST", {
  name: "Match bike",
  brand: "Giant",
  model: "Tourer",
  year: 2024,
  category: "road",
  description: "",
  color: "",
  size: "",
  weight: null,
  is_public: true,
});
assert.equal(bike.status, 201, JSON.stringify(bike.body));
const plan = await organizer("rides/plan", "POST", {
  bikeId: bike.body.id,
  title: "Match HTTP plan",
  description: "",
  isPublic: true,
  privacyEnabled: false,
  privacyRadiusM: 500,
  scheduledAt: `${date}T11:00:00+03:00`,
  expectedEndAt: `${date}T13:00:00+03:00`,
  meetingPoint: "Hidden HTTP gate",
  passport: { purpose: "social", area: { label: "HTTP park" } },
});
assert.equal(plan.status, 201, JSON.stringify(plan.body));
const intent = {
  readiness: "ready",
  timeZone: "Europe/Moscow",
  windows: [{ startLocal: date + "T10:00", endLocal: date + "T15:00" }],
  passport: { area: { label: "HTTP park" }, purpose: "social" },
  visibility: "community",
  allowSuggestions: true,
};
const created = await rider("ride-intents", "POST", {
  ...intent,
  requestId: randomUUID(),
});
assert.equal(created.status, 201, JSON.stringify(created.body));

assert.equal((await guest("ride-matches/rides")).status, 401);
assert.equal(
  (await guest("ride-matches/interest?durationMin=60&durationMax=60")).status,
  401,
);
const found = await rider("ride-matches/rides");
assert.equal(found.status, 200, found.text);
assert.equal(found.headers.get("cache-control"), "no-store");
assert.equal(found.body.basis, "intents");
const item = found.body.items.find((i) => i.ride.id === plan.body.id);
assert.ok(item, "the fitting public plan is suggested");
assert.equal(item.match.reasons[0].code, "time_fits");
assert.ok(item.match.unknown.includes("area"), "equal labels are not a match");
assert.doesNotMatch(found.text, /Hidden HTTP gate|@example\.test/);
for (const bad of [
  "ride-matches/rides?pace=fast",
  "ride-matches/rides?pace=relaxed&pace=sporty",
  "ride-matches/rides?address=home",
  "ride-matches/rides?lng=37&lat=55",
  "ride-matches/interest?from=" + encodeURIComponent(date + "T00:00:00Z"),
  "ride-matches/plans/not-a-uuid/interest",
])
  assert.equal((await rider(bad)).status, 400, bad);
assert.equal((await rider("ride-matches/elsewhere")).status, 404);
assert.equal((await rider("ride-matches/rides", "POST", {})).status, 405);

// #233: the viewer's own upcoming commitments and public plan filters.
assert.equal((await guest("ride-matches/upcoming")).status, 401);
assert.equal((await organizer("ride-matches/upcoming?x=1")).status, 400);
const upcoming = await organizer("ride-matches/upcoming");
assert.equal(upcoming.status, 200, upcoming.text);
assert.equal(upcoming.headers.get("cache-control"), "no-store");
assert.equal(
  upcoming.body.rides.find((r) => r.id === plan.body.id)?.role,
  "organizer",
);
assert.equal(
  (await rider("ride-matches/upcoming")).body.rides.some(
    (r) => r.id === plan.body.id,
  ),
  false,
  "no answer yet: not in the rider's plans",
);
const filtered = await guest(
  "rides?status=planned&purpose=social&area=" + encodeURIComponent("HTTP"),
);
assert.equal(filtered.status, 200, filtered.text);
assert.ok(filtered.body.rides.some((r) => r.id === plan.body.id));
assert.doesNotMatch(filtered.text, /Hidden HTTP gate/);
assert.equal(
  (await guest("rides?status=planned&purpose=training")).body.rides.some(
    (r) => r.id === plan.body.id,
  ),
  false,
);
for (const bad of [
  "rides?status=planned&pace=fast",
  "rides?status=planned&durationMax=0",
  "rides?status=planned&from=tomorrow",
])
  assert.equal((await guest(bad)).status, 400, bad);
const interestPath = `ride-matches/plans/${plan.body.id}/interest`;
const interest = await organizer(interestPath);
assert.equal(interest.status, 200, interest.text);
assert.equal(interest.body.counts.total, 1);
assert.equal(interest.body.counts.ready, 1);
assert.deepEqual(
  interest.body.people.items.map((p) => p.author.id),
  [riderId],
);
assert.doesNotMatch(
  interest.text,
  /@example\.test|allowSuggestions|Hidden HTTP gate/,
);
// Only the organizer sees who is interested in their plan.
assert.equal((await rider(interestPath)).status, 404);
assert.equal(
  (await organizer(`ride-matches/plans/${randomUUID()}/interest`)).status,
  404,
);
const draft = await organizer(
  "ride-matches/interest?start=" +
    encodeURIComponent(`${date}T12:00:00+03:00`) +
    "&durationMin=60&durationMax=90",
);
assert.equal(draft.status, 200, draft.text);
assert.equal(draft.body.counts.total, 1);
// #234: «Собрать компанию» — counts only, and explicit invitations re-checked
// on the server.
const period =
  "from=" +
  encodeURIComponent(`${date}T09:00:00+03:00`) +
  "&to=" +
  encodeURIComponent(`${date}T16:00:00+03:00`) +
  "&durationMin=60&durationMax=120";
assert.equal((await guest("ride-matches/groups?" + period)).status, 401);
assert.equal(
  (await organizer("ride-matches/groups?from=" + encodeURIComponent(date)))
    .status,
  400,
);
const groups = await organizer(
  "ride-matches/groups?" + period + "&purpose=social",
);
assert.equal(groups.status, 200, groups.text);
assert.equal(groups.headers.get("cache-control"), "no-store");
assert.equal(groups.body.groups[0].counts.total, 1);
assert.doesNotMatch(
  groups.text,
  new RegExp(`${riderId}|author|username|@example\\.test|HTTP park`),
);
assert.equal(
  (await organizer("ride-matches/groups?" + period + "&purpose=training")).body
    .groups.length,
  0,
);
const invitePath = `ride-matches/plans/${plan.body.id}/invitations`;
const occurrenceAt = interest.body.occurrenceAt;
assert.equal(
  (
    await organizer(
      invitePath,
      "POST",
      { occurrenceAt, userIds: [riderId] },
      "https://evil.test",
    )
  ).status,
  403,
);
assert.equal(
  (await guest(invitePath, "POST", { occurrenceAt, userIds: [riderId] }))
    .status,
  401,
);
assert.equal(
  (await rider(invitePath, "POST", { occurrenceAt, userIds: [organizerId] }))
    .status,
  404,
  "only the organizer invites to their plan",
);
for (const bad of [
  {},
  { occurrenceAt, userIds: [] },
  { occurrenceAt, userIds: ["nope"] },
  { occurrenceAt, userIds: [riderId], extra: true },
])
  assert.equal(
    (await organizer(invitePath, "POST", bad)).status,
    400,
    JSON.stringify(bad),
  );
const sent = await organizer(invitePath, "POST", {
  occurrenceAt,
  userIds: [riderId],
});
assert.equal(sent.status, 200, sent.text);
assert.deepEqual(sent.body.results, [{ userId: riderId, status: "invited" }]);
const again = await organizer(invitePath, "POST", {
  occurrenceAt,
  userIds: [riderId],
});
assert.deepEqual(again.body.results, [
  { userId: riderId, status: "already_invited" },
]);
assert.equal(
  (await organizer(interestPath)).body.people.items[0].invited,
  true,
);
// Withdrawing consent to be shown takes effect on the next read.
const put = await rider("ride-intents/" + created.body.intent.id, "PUT", {
  ...intent,
  visibility: "private",
  allowSuggestions: false,
});
assert.equal(put.status, 200, put.text);
assert.equal((await organizer(interestPath)).body.counts.total, 0);
// The rider's own private intent still drives their own search.
assert.ok(
  (await rider("ride-matches/rides")).body.items.some(
    (i) => i.ride.id === plan.body.id,
  ),
);
assert.notEqual(organizerId, riderId);
console.log(
  "Ride matches HTTP: session, validation, owner-only interest, upcoming, public filters, no-store and consent withdrawal passed",
);
