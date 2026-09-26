import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.TEST_ORIGIN || "http://localhost:3000";
function client() {
  let cookie = "";
  return async (url, method = "GET", data, origin = base) => {
    const r = await fetch(base + "/api/" + url, {
      method,
      headers: {
        origin,
        ...(cookie ? { cookie } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, body: await r.json() };
  };
}
const owner = client(),
  voter = client(),
  guest = client(),
  nonce = randomUUID();
let id;
try {
  for (const [who, name] of [
    [owner, "Author"],
    [voter, "Voter"],
  ])
    assert.equal(
      (
        await who("auth/register", "POST", {
      ...testConsents,
          name,
          email: name + nonce + "@example.test",
          password: "testing-colabike-123",
        })
      ).status,
      201,
    );
  id = (
    await owner("bikes", "POST", {
      name: nonce,
      brand: "CUBE",
      model: "Travel",
      year: 2020,
      category: "road",
      description: "",
      color: "",
      size: "",
      weight: 14,
      price: 99999,
      is_public: false,
    })
  ).body.id;
  assert.equal((await guest("showcase?q=" + nonce)).body.total, 0);
  assert.equal((await guest("bikes/" + id + "/like", "PUT")).status, 401);
  await owner("bikes/" + id + "/share", "PATCH", { is_public: true });
  const feed = (await guest("showcase?q=" + nonce)).body;
  assert.equal(feed.total, 1);
  assert.equal(feed.bikes[0].price, undefined);
  assert.equal((await owner("bikes/" + id + "/like", "PUT")).status, 403);
  assert.equal(
    (
      await voter(
        "bikes/" + id + "/like",
        "PUT",
        undefined,
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal((await voter("bikes/" + id + "/like", "PUT")).body.likes, 1);
  assert.equal((await voter("bikes/" + id + "/like", "PUT")).body.likes, 1);
  assert.equal((await voter("bikes/" + id + "/like", "DELETE")).body.likes, 0);
  assert.equal(
    (
      await voter("profile", "PATCH", {
        name: "Changed",
        preferences: { bikeLayout: "dense" },
      })
    ).status,
    200,
  );
  assert.equal((await voter("me")).body.user.preferences.bikeLayout, "dense");
  assert.equal((await owner("me")).body.user.preferences.bikeLayout, undefined);
  assert.equal(
    (
      await voter("profile", "PATCH", {
        name: "Changed",
        preferences: { registrationOpen: false },
      })
    ).status,
    400,
  );
  await owner("bikes/" + id + "/share", "PATCH", { is_public: false });
  assert.equal((await guest("showcase?q=" + nonce)).body.total, 0);
  assert.equal((await voter("bikes/" + id + "/like", "PUT")).status, 404);
  console.log(
    "Showcase HTTP: public feed, privacy, votes, CSRF, revocation and isolated personal settings passed.",
  );
} finally {
  if (id) await owner("bikes/" + id, "DELETE");
}
