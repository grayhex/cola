import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
function client() {
  let cookie = "";
  return async (path, method = "GET", data, requestOrigin = origin) => {
    const r = await fetch(origin + "/api/" + path, {
      method,
      headers: {
        origin: requestOrigin,
        ...(cookie ? { cookie } : {}),
        ...(data ? { "content-type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, body: await r.json() };
  };
}
const owner = client(),
  reader = client(),
  guest = client(),
  nonce = randomUUID();
for (const [i, c] of [owner, reader].entries())
  assert.equal(
    (
      await c("auth/register", "POST", {
      ...testConsents,
        name: "Discovery " + i,
        email: nonce + i + "@discovery.test",
        password: "discovery-http-secret",
      })
    ).status,
    201,
  );
const bike = (
  await owner("bikes", "POST", {
    name: "Experience " + nonce,
    brand: "Cube",
    model: "Travel",
    year: 2020,
    category: "road",
    description: "",
    color: "",
    size: "",
    weight: null,
    is_public: true,
    purposes: ["travel"],
  })
).body;
const input = {
  bikeId: bike.id,
  kind: "question",
  title: "Solution " + nonce,
  body: "A real owner question",
  status: "published",
  isPublic: true,
};
const entry = (await owner("journal", "POST", input)).body;
assert.equal((await guest("community/feed?type=journal&mode=new")).status, 200);
assert.equal(
  (await guest("community/feed?type=journal&mode=following")).status,
  401,
);
assert.equal((await guest("community/saved")).status, 401);
assert.equal(
  (await guest("community/bikes/" + bike.id + "/follow", "PUT")).status,
  401,
);
assert.equal(
  (
    await reader(
      "community/bikes/" + bike.id + "/follow",
      "PUT",
      null,
      "https://evil.example",
    )
  ).status,
  403,
);
assert.equal(
  (await reader("community/bikes/" + bike.id + "/follow", "PUT")).status,
  200,
);
const subscribed = (await reader("community/feed?type=journal&mode=following"))
  .body;
assert(subscribed.items.some((i) => i.id === entry.id));
assert.equal(
  (await reader("journal/" + entry.id + "/save", "PUT")).status,
  200,
);
assert.equal((await reader("community/saved")).body.entries.length, 1);
assert.equal((await owner("community/saved")).body.entries.length, 0);
const comment = (
  await reader("journal/" + entry.id + "/comments", "POST", {
    body: "This worked for me",
  })
).body;
assert.equal(
  (
    await reader("journal/" + entry.id + "/solution", "PUT", {
      commentId: comment.id,
    })
  ).status,
  404,
);
assert.equal(
  (
    await owner("journal/" + entry.id + "/solution", "PUT", {
      commentId: comment.id,
    })
  ).status,
  200,
);
assert.equal(
  (await guest("journal/public/" + entry.shareId)).body.entry.solutionId,
  comment.id,
);
assert.equal(
  (
    await guest(
      "search?" +
        new URLSearchParams({
          type: "journal",
          q: nonce,
          brand: "Куб",
          model: "Tra-vel",
          year: "2020",
          purpose: "travel",
        }),
    )
  ).body.total,
  1,
);
assert.equal((await guest("search?year=nope")).status, 400);
assert.equal((await guest("search?purpose=arbitrary")).status, 400);
assert.equal((await reader("admin/overview")).status, 403);
assert.equal(
  (await owner("bikes/" + bike.id + "/share", "PATCH", { is_public: false }))
    .status,
  200,
);
assert.equal((await reader("community/saved")).body.total, 0);
assert.equal(
  (await reader("community/feed?type=journal&mode=following")).body.total,
  0,
);
assert.equal(
  (await guest("search?" + new URLSearchParams({ type: "journal", q: nonce })))
    .body.total,
  0,
);
assert.equal((await guest("search?similar=" + bike.id)).status, 404);
assert.equal(
  (await reader("journal/" + entry.id + "/save", "PUT")).status,
  404,
);
assert.equal(
  (await reader("journal/" + entry.id + "/save", "DELETE")).status,
  200,
);
assert.equal(
  (await owner("community/notifications")).body.notifications.filter(
    (n) => n.target.type === "journal",
  ).length,
  0,
);
console.log(
  "Discovery HTTP passed: public feed, auth/CSRF, bike follow, bookmarks, solution ownership, aliases, filters and privacy revocation",
);
