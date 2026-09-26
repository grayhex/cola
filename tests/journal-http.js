import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
function client() {
  let cookie = "";
  return async (path, method = "GET", body, origin = base) => {
    const r = await fetch(base + "/api/" + path, {
      method,
      headers: {
        cookie,
        origin,
        "Content-Type": Buffer.isBuffer(body)
          ? "image/png"
          : "application/json",
      },
      body: body
        ? Buffer.isBuffer(body)
          ? body
          : JSON.stringify(body)
        : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return {
      status: r.status,
      headers: r.headers,
      body: r.headers.get("content-type")?.includes("json")
        ? await r.json()
        : Buffer.from(await r.arrayBuffer()),
    };
  };
}
const a = client(),
  b = client(),
  guest = client(),
  nonce = randomUUID();
for (const [i, c] of [a, b].entries())
  assert.equal(
    (
      await c("auth/register", "POST", {
      ...testConsents,
        name: "Journal " + i,
        email: i + nonce + "@example.test",
        password: "journal-http-secret-123",
      })
    ).status,
    201,
  );
const bike = (
  await a("bikes", "POST", {
    name: "Journal test",
    brand: "Cube",
    model: "Travel",
    year: 2026,
    category: "road",
    description: "",
    color: "",
    size: "",
    weight: null,
    is_public: true,
  })
).body.id;
const form = {
  bikeId: bike,
  kind: "story",
  title: "A first story",
  body: "Experience",
  status: "draft",
  isPublic: true,
};
assert.equal((await guest("journal", "POST", form)).status, 401);
assert.equal(
  (await a("journal", "POST", form, "https://evil.example")).status,
  403,
);
assert.equal((await b("journal", "POST", form)).status, 404);
assert.equal(
  (await a("journal", "POST", { ...form, status: "published", body: "" }))
    .status,
  400,
);
const created = await a("journal", "POST", form);
assert.equal(created.status, 201, JSON.stringify(created.body));
const { id, shareId } = created.body;
assert.equal((await guest("journal/public/" + shareId)).status, 404);
assert.equal((await b("journal/" + id, "PATCH", form)).status, 404);
assert.equal(
  (await a("journal/" + id + "/photos", "POST", Buffer.from("<svg/>"))).status,
  400,
);
const bytes = await sharp({
  create: { width: 200, height: 100, channels: 3, background: "#e0e0e0" },
})
  .png()
  .toBuffer();
const uploaded = await a("journal/" + id + "/photos", "POST", bytes);
assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
const media = "journal/media/" + uploaded.body.id;
assert.equal((await guest(media)).status, 404);
assert.equal((await b("journal/" + id + "/photos", "POST", bytes)).status, 404);
assert.equal(
  (await a("journal/" + id, "PATCH", { ...form, status: "published" })).status,
  200,
);
assert.equal(
  (await guest("journal/public/" + shareId)).body.entry.title,
  form.title,
);
const photo = await guest(media);
assert.equal(photo.status, 200);
// Browsers revalidate every use, so revoked access is re-checked on the server.
assert.equal(photo.headers.get("cache-control"), "private, no-cache");
assert.ok(photo.headers.get("etag"));
assert.equal(photo.headers.get("content-type"), "image/webp");
assert.equal((await b("journal/" + id + "/like", "PUT")).status, 200);
const comment = await b("journal/" + id + "/comments", "POST", {
  body: "Looks good",
});
assert.equal(comment.status, 201);
assert.equal(
  (
    await a("journal/" + id + "/comments", "POST", {
      body: "Thank you",
      parentId: comment.body.id,
    })
  ).status,
  201,
);
assert.equal(
  (
    await b("community/reports", "POST", {
      entityType: "journal",
      targetId: id,
      reason: "other",
    })
  ).status,
  200,
);
assert(
  (await a("community/notifications")).body.notifications.some(
    (n) => n.target.type === "journal",
  ),
);
assert.equal(
  (await a("bikes/" + bike + "/share", "PATCH", { is_public: false })).status,
  200,
);
for (const c of [guest, b]) {
  assert.equal((await c("journal/public/" + shareId)).status, 404);
  assert.equal((await c(media)).status, 404);
  assert.equal((await c("journal?bikeId=" + bike)).body.entries.length, 0);
  assert.equal((await c("journal/" + id + "/comments")).status, 404);
  assert.equal(
    (await c("journal/" + id + "/comments/" + comment.body.id + "/replies"))
      .status,
    404,
  );
}
assert.equal((await b("journal/" + id + "/like", "PUT")).status, 404);
assert.equal(
  (await b("journal/" + id + "/comments", "POST", { body: "Hidden" })).status,
  404,
);
assert.equal(
  (await a("community/notifications")).body.notifications.filter(
    (n) => n.target.type === "journal",
  ).length,
  0,
);
assert.equal((await a(media)).status, 200);
assert.equal((await a("journal/public/" + shareId)).status, 200);
assert.equal((await a("journal/" + id, "DELETE")).status, 200);
assert.equal((await a(media)).status, 404);
console.log(
  "Journal HTTP passed: draft -> publish -> image/comment/reply/like/report -> parent privacy revocation -> delete, CSRF and owner guards",
);
