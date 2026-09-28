import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { writeFile, rename } from "node:fs/promises";
import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
function client() {
  let cookie = "";
  return async (path, method = "GET", body, origin = base) => {
    const r = await fetch(base + "/api/" + path, {
      method,
      redirect: "manual",
      headers: { cookie, origin, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return {
      status: r.status,
      location: r.headers.get("location"),
      body: r.headers.get("content-type")?.includes("json")
        ? await r.json()
        : null,
    };
  };
}
const a = client(),
  b = client(),
  guest = client(),
  uid = Math.floor(Math.random() * 1000000) + 1;
for (const c of [a, b])
  assert.equal(
    (
      await c("auth/register", "POST", {
        ...testConsents,
        name: "Sync Rider",
        email: randomUUID() + "@example.test",
        password: "sync-test-password-123",
      })
    ).status,
    201,
  );
const bike = (
  await a("bikes", "POST", {
    name: "Sync road",
    brand: "Giant",
    model: "Contend",
    year: 2026,
    category: "road",
    description: "",
    color: "",
    size: "M",
    weight: 9,
    is_public: false,
  })
).body.id;
const root = "activity-sync/rwgps";
assert.equal((await guest(root)).status, 401);
assert.equal(
  (await a(root + "/connect", "POST", {}, "https://evil.test")).status,
  403,
);
const state = new URL(
  (await a(root + "/connect", "POST", { bikeId: bike })).body.url,
).searchParams.get("state");
assert.ok(state);
assert.match(
  (await b(root + "/callback?state=" + state + "&code=" + uid)).location,
  /activity_sync=error/,
);
assert.equal((await b(root)).body.connected, false);
assert.match(
  (await a(root + "/callback?state=" + state + "&code=" + uid)).location,
  /activity_sync=connected/,
);
assert.match(
  (await a(root + "/callback?state=" + state + "&code=" + uid)).location,
  /activity_sync=error/,
);
const wait = async (check) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("Activity worker timed out");
};
await wait(async () => (await a(root)).body.counts?.synced === 1);
let rides = (await a("rides?own=1")).body.rides;
assert.equal(rides.length, 1);
const id = rides[0].id;
assert.equal(rides[0].isPublic, false);
assert.ok(!JSON.stringify((await a(root)).body).includes("fixture-rwgps-"));
const notifications = {
  notifications: [
    {
      user_id: uid,
      item_user_id: uid,
      item_type: "trip",
      item_id: uid * 10 + 1,
      action: "created",
    },
  ],
};
async function webhook(value, valid = true) {
  const body = JSON.stringify(value);
  return fetch(base + "/api/" + root + "/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-rwgps-api-key": "fixture-api",
      "x-rwgps-signature": valid
        ? createHmac("sha256", "fixture-secret").update(body).digest("hex")
        : "0".repeat(64),
    },
    body,
  });
}
assert.equal((await webhook(notifications, false)).status, 401);
assert.equal((await webhook(notifications)).status, 200);
assert.equal((await webhook(notifications)).status, 200);
await wait(async () => !(await a(root)).body.pending);
assert.equal((await a("rides?own=1")).body.rides.length, 1);
// A signed deletion is reconciled through the authenticated sync endpoint.
await writeFile(
  process.env.RWGPS_FIXTURE_FILE + ".tmp",
  JSON.stringify({
    [uid]: {
      items: [
        {
          ...notifications.notifications[0],
          action: "deleted",
          datetime: new Date().toISOString(),
        },
      ],
    },
  }),
);
await rename(
  process.env.RWGPS_FIXTURE_FILE + ".tmp",
  process.env.RWGPS_FIXTURE_FILE,
);
assert.equal(
  (
    await webhook({
      notifications: [{ ...notifications.notifications[0], action: "deleted" }],
    })
  ).status,
  200,
);
await wait(async () => !(await a("rides?own=1")).body.rides.length);
assert.equal((await a("rides/owner/" + id)).status, 404);
assert.equal((await a(root, "DELETE", {}, "https://evil.test")).status, 403);
assert.equal((await a(root, "DELETE")).status, 200);
assert.equal((await a(root)).body.connected, false);
assert.equal((await webhook(notifications)).status, 200);
assert.equal((await a(root)).body.connected, false);
console.log(
  "RWGPS HTTP: session-bound OAuth, signed queue, FIT import, duplicates, remote delete and disconnect passed.",
);
