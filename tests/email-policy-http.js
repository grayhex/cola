import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import { garminCsv } from "./garmin-fixtures.js";
const origin = process.env.TEST_ORIGIN || "http://localhost:3100";
const email = `policy-${randomUUID()}@example.test`;
let cookie;
async function call(path, method = "GET", data) {
  const r = await fetch(origin + "/api/" + path, {
    method, headers: { origin, ...(cookie ? { cookie } : {}), "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (r.headers.get("set-cookie")) cookie = r.headers.get("set-cookie").split(";")[0];
  return { status: r.status, body: await r.json() };
}
assert.equal((await call("auth/register", "POST", { ...testConsents, name: "Policy", email, password: "policy-password-123" })).status, 201);
const user = (await call("me")).body.user;
assert.equal(user.email_verified_at, null);
const bike = { name: "Policy bike", brand: "Cube", model: "Travel", year: 2020, category: "road", description: "", color: "", size: "", weight: null, is_public: false };
const bikeId = (await call("bikes", "POST", bike)).body.id;
assert.ok(bikeId, "unverified users create private bikes");
const entry = { bikeId, kind: "story", title: "Policy entry", body: "Preserve this draft", status: "draft", isPublic: false };
const article = { title: "Policy article", body: "Preserve article", topicId: "experience", status: "draft" };
// Use an actual configured topic for the publication checks.
const site = await (await fetch(origin + "/api/site")).json();
article.topicId = site.settings?.articleTopics?.[0]?.id || "experience";
const market = { title: "Policy listing", description: "Private draft", category: "components", condition: "used", location: "", contact: "secret-contact", status: "draft" };
const entryId = (await call("journal", "POST", entry)).body.id;
const articleId = (await call("articles", "POST", article)).body.id;
const listingId = (await call("market", "POST", market)).body.id;
assert.ok(entryId && articleId && listingId, "all private drafts can be saved");
const ride = { bikeId, title: "Policy ride", isPublic: true, privacyEnabled: false, privacyRadiusM: 500 };
const rejected = [
  ["bikes", "POST", { ...bike, is_public: true }],
  ["bikes/wizard", "POST", { requestId: randomUUID(), bike: { ...bike, is_public: true }, components: [] }],
  [`bikes/${bikeId}`, "PATCH", { is_public: true }],
  [`bikes/${bikeId}/share`, "PATCH", { is_public: true }],
  ["journal", "POST", { ...entry, status: "published", isPublic: true }],
  [`journal/${entryId}`, "PATCH", { ...entry, status: "published", isPublic: true }],
  ["articles", "POST", { ...article, status: "published" }],
  [`articles/${articleId}`, "PATCH", { ...article, status: "published" }],
  ["market", "POST", { ...market, status: "active" }],
  [`market/${listingId}`, "PATCH", { ...market, status: "active" }],
  [`market/${listingId}/extend`, "POST", {}],
  [`market/public/${randomUUID()}/contact`, "GET"],
  ["rides", "POST", { ...ride, previewId: randomUUID() }],
  [`rides/${randomUUID()}`, "PATCH", ride],
  ["rides/plan", "POST", { ...ride, scheduledAt: new Date(Date.now() + 86400000).toISOString() }],
  ["rides/import", "POST", { bikeId, csv: garminCsv(), utcOffsetMinutes: 0, units: "metric", isPublic: true, selected: [0], visibleMetrics: [] }],
];
for (const [path, method, data] of rejected) {
  const r = await call(path, method, data);
  assert.equal(r.status, 403, path + ": " + JSON.stringify(r.body));
  assert.equal(r.body.code, "EMAIL_VERIFICATION_REQUIRED", path);
}
for (const kind of ["journal", "articles", "rides"]) {
  for (const [path, method, data] of [[`${kind}/${randomUUID()}/comments`, "POST", { body: "reply", parentId: randomUUID() }], [`${kind}/comments/${randomUUID()}`, "PATCH", { body: "edit" }]]) {
    const r = await call(path, method, data);
    assert.equal(r.body.code, "EMAIL_VERIFICATION_REQUIRED", path);
  }
}
// Resend keeps the same draft/session and has a real per-user rate limit.
for (let i = 0; i < 3; i++) assert.equal((await call("account/email-verification", "POST")).status, 200);
assert.equal((await call("account/email-verification", "POST")).status, 429);
await verifyCapturedEmail(email);
assert.ok((await call("me")).body.user.email_verified_at);
assert.equal((await call(`bikes/${bikeId}/share`, "PATCH", { is_public: true })).status, 200);

assert.equal((await call(`journal/${entryId}`, "PATCH", { ...entry, status: "published", isPublic: true })).status, 200);
assert.equal((await call(`articles/${articleId}`, "PATCH", { ...article, status: "published" })).status, 200);
const listing = await call(`market/${listingId}`, "PATCH", { ...market, status: "active" });
assert.equal(listing.status, 200);
assert.equal((await call(`market/public/${listing.body.shareId}/contact`)).status, 200);
const comment = await call(`community/bikes/${bikeId}/comments`, "POST", { body: "Verified comment" });
assert.equal(comment.status, 201);
const other = randomUUID(), otherBike = randomUUID();
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("UPDATE users SET email_verified_at=NULL WHERE id=$1", [user.id]);
  assert.equal((await call(`community/bikes/${bikeId}/comments`, "POST", { body: "Denied", parentId: comment.body.id })).body.code, "EMAIL_VERIFICATION_REQUIRED");
  assert.equal((await call(`community/comments/${comment.body.id}`, "PATCH", { body: "Denied edit" })).body.code, "EMAIL_VERIFICATION_REQUIRED");
  assert.equal((await call(`community/comments/${comment.body.id}`, "DELETE")).status, 200);
  await db.query("INSERT INTO users(id,email,name,password_hash,username) VALUES($1,$2,'Legacy owner','unused',$3)", [other, `legacy-${other}@example.test`, 'legacy-' + other.slice(0, 8)]);
  await db.query("INSERT INTO bikes(id,owner_id,name,brand,model,year,category,is_public,share_id) VALUES($1,$2,'Legacy bike','Cube','Travel',2020,'road',true,$3)", [otherBike, other, randomUUID()]);
  assert.equal((await call(`bikes/${otherBike}/like`, "PUT")).status, 200);
  assert.equal((await call(`community/bikes/${otherBike}/follow`, "PUT")).status, 200);
  assert.equal((await call(`market/${listingId}/save`, "PUT")).status, 200);
  assert.equal((await call(`market/public/${listing.body.shareId}/contact`)).body.code, "EMAIL_VERIFICATION_REQUIRED");
  assert.equal((await call(`journal/${entryId}`, "PATCH", entry)).status, 200);
  assert.equal((await call(`articles/${articleId}`, "PATCH", article)).status, 200);
  assert.equal((await call(`market/${listingId}`, "PATCH", market)).status, 200);
  assert.equal((await call(`bikes/${bikeId}/share`, "PATCH", { is_public: false })).status, 200);
  await db.query("UPDATE users SET blocked=true,email_verified_at=now() WHERE id=$1", [user.id]);
  assert.equal((await call("market", "POST", { ...market, status: "active" })).status, 401);
  await db.query("UPDATE users SET blocked=false,email_verified_at=NULL WHERE id=$1", [user.id]);
  for (const [kind,id] of [["journal",entryId],["articles",articleId],["market",listingId],["bikes",bikeId]]) assert.equal((await call(`${kind}/${id}`, "DELETE")).status, 200);
} finally {
  await db.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[user.id, other]]);
  await db.end();
}
console.log("Email policy HTTP: publication paths, drafts, verification/resend, comments, contacts, privacy, deletion and blocked sessions passed.");
