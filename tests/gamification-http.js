import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { exerciseGameArtwork } from "./gamification-artwork-http.js";
const base = process.env.TEST_ORIGIN || "http://localhost:3100",
  q = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
function client() {
  let cookie = "";
  return async (path, method = "GET", body, origin = base) => {
    const r = await fetch(base + "/api/" + path, {
      method,
      headers: { cookie, origin, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, body: await r.json() };
  };
}
const a = client(),
  b = client(),
  admin = client(),
  guest = client(),
  ids = [],
  nonce = randomUUID().slice(0, 8);
try {
  for (const [i, c] of [a, b, admin].entries()) {
    assert.equal(
      (
        await c("auth/register", "POST", {
          name: "gamer" + i,
          email: nonce + i + "@example.test",
          password: "games-secret-123",
        })
      ).status,
      201,
    );
    ids.push((await c("me")).body.user.id);
  }
  await q.query("UPDATE users SET role='admin' WHERE id=$1", [ids[2]]);
  const input = {
    name: "Game " + nonce,
    brand: "Cube",
    model: "Travel",
    year: 2020,
    category: "road",
    description: "",
    color: "",
    size: "",
    weight: 8,
    is_public: true,
    price: 876543210,
    show_bike_price: false,
  };
  const id = (await a("bikes", "POST", input)).body.id;
  assert.equal((await guest("game/records")).status, 200);
  assert(
    !JSON.stringify((await guest("game/records")).body).includes("876543210"),
  );
  assert.equal((await guest("game/bikes/" + id)).status, 200);
  assert.equal((await guest("game/me")).status, 401);
  assert.equal(
    (await a("game/bikes/" + id + "/reactions/wild", "PUT")).status,
    403,
  );
  assert.equal(
    (
      await b(
        "game/bikes/" + id + "/reactions/wild",
        "PUT",
        null,
        "https://evil.test",
      )
    ).status,
    403,
  );
  assert.equal(
    (await b("game/bikes/" + id + "/reactions/wild", "PUT")).status,
    200,
  );
  assert.equal(
    (await b("game/bikes/" + id + "/reactions/wild", "PUT")).body.reactions[0]
      .count,
    1,
  );
  assert.equal(
    (await b("game/bikes/" + id + "/reactions/nope", "PUT")).status,
    400,
  );
  assert.equal((await b("game/admin/settings")).status, 403);
  const settings = (await admin("game/admin/settings")).body;
  await exerciseGameArtwork(admin, guest, a, q);
  assert.equal(
    (
      await admin("game/admin/settings", "PUT", {
        ...settings,
        weightMinimum: 60,
        weightMaximum: 50,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await admin("game/admin/bikes/" + id, "PATCH", {
        excluded: true,
        reason: "Test exclusion",
      })
    ).status,
    200,
  );
  assert.equal(
    (await q.query("SELECT leaderboard_excluded FROM bikes WHERE id=$1", [id]))
      .rows[0].leaderboard_excluded,
    true,
  );
  await admin("game/admin/bikes/" + id, "PATCH", {
    excluded: false,
    reason: "Verified",
  });
  const name = (await a("me")).body.user.username;
  const shelf = (await guest("game/profiles/" + name)).body;
  assert(shelf.awards.some((x) => x.key === "first_public"));
  assert(!JSON.stringify(shelf).includes("876543210"));
  await q.query("UPDATE bikes SET is_public=false WHERE id=$1", [id]);
  assert.equal((await guest("game/bikes/" + id)).status, 404);
  assert.equal(
    (await b("game/bikes/" + id + "/reactions/clean", "PUT")).status,
    404,
  );
  await q.query("UPDATE users SET blocked=true WHERE id=$1", [ids[0]]);
  assert.equal((await guest("game/profiles/" + name)).status, 404);
  await q.query("UPDATE users SET blocked=false WHERE id=$1", [ids[0]]);
  await q.query("UPDATE bikes SET is_public=true WHERE id=$1", [id]);
  let limited = false;
  for (let i = 0; i < 65; i++) {
    const r = await b("game/bikes/" + id + "/reactions/wild", "PUT");
    if (r.status === 429) {
      limited = true;
      break;
    }
  }
  assert(limited);
  console.log(
    "Gamification HTTP passed: privacy, awards, origin, ownership, reactions, limits and audited admin exclusion",
  );
} finally {
  await q.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  await q.end();
}
