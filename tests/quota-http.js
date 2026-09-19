import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const base = process.env.TEST_ORIGIN;
let cookie = "";
async function api(url, method = "GET", data) {
  const r = await fetch(base + "/api/" + url, {
    method,
    headers: { origin: base, cookie, "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  return { status: r.status, body: await r.json() };
}
await api("auth/register", "POST", {
  name: "Quota",
  email: randomUUID() + "@example.test",
  password: "quota-tests-12345",
});
const body = {
  name: "Quota bike",
  brand: "Cube",
  model: "Travel",
  year: 2020,
  category: "road",
  description: "",
  color: "",
  size: "",
  weight: 14,
};
const created = await Promise.all(
  Array.from({ length: 21 }, () => api("bikes", "POST", body)),
);
assert.equal(created.filter((r) => r.status === 201).length, 20);
assert.equal(created.filter((r) => r.status === 409).length, 1);
const bikes = created.filter((r) => r.status === 201).map((r) => r.body.id),
  id = bikes[0];
const bytes = await sharp({
  create: { width: 600, height: 400, channels: 3, background: "white" },
})
  .png()
  .toBuffer();
async function upload(target = id) {
  return fetch(base + "/api/bikes/" + target + "/photos", {
    method: "POST",
    headers: { origin: base, cookie, "Content-Type": "image/png" },
    body: bytes,
  });
}
const uploaded = await Promise.all(Array.from({ length: 14 }, () => upload()));
assert.equal(uploaded.filter((r) => r.status === 201).length, 12);
assert.equal(uploaded.filter((r) => r.status === 409).length, 2);
const bike = (await api("bikes/" + id)).body.bike;
assert.equal(bike.photos.length, 12);
await api("bikes/" + id + "/photos/" + bike.photos[0].id, "DELETE");
assert.equal((await upload()).status, 201);
const cross = await Promise.all(
  Array.from({ length: 20 }, (_, i) => upload(bikes[1 + (i % 2)])),
);
assert.equal(cross.filter((r) => r.status === 201).length, 8);
assert.equal(cross.filter((r) => r.status === 409).length, 12);
await api("bikes/" + bikes.pop(), "DELETE");
assert.equal((await api("bikes", "POST", body)).status, 201);
for (const b of (await api("bikes")).body.bikes)
  await api("bikes/" + b.id, "DELETE");
console.log(
  "Quota HTTP: concurrent creation and uploads stay bounded; deletion releases quota.",
);
