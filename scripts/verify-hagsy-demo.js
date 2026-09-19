import assert from "node:assert/strict";
const base = process.env.TEST_ORIGIN || "http://127.0.0.1:3000";
const list = await fetch(base + "/api/rides?username=hagsy_test", {
  signal: AbortSignal.timeout(15000),
});
assert.equal(list.status, 200);
const { rides } = await list.json();
assert.equal(rides.length, 1);
const ride = rides[0];
assert.equal(ride.title, "Покатушка 16 сентября");
assert.equal(ride.bike.name, "Giant Tourer GTS");
assert.equal(ride.metrics.distanceM, 26460);
const detailResponse = await fetch(base + "/api/rides/public/" + ride.shareId);
assert.equal(detailResponse.status, 200);
const detail = (await detailResponse.json()).ride;
assert.ok(detail.geometry.length > 0);
assert.equal(detail.sourceHash, undefined);
for (const path of [
  "/u/hagsy_test",
  "/b/" + ride.bike.shareId,
  "/r/" + ride.shareId,
]) {
  assert.equal((await fetch(base + path)).status, 200);
}
console.log(
  JSON.stringify({
    verified: true,
    profile: "/u/hagsy_test",
    bike: "/b/" + ride.bike.shareId,
    ride: "/r/" + ride.shareId,
    distanceM: ride.metrics.distanceM,
  }),
);
