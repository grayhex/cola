import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testConsents } from "./fixtures/legal.js";

// The place search for choosing a ride's area (#370), through the real server.
// The test server answers from the built-in list (COLA_GEOCODER_FIXTURE=1): no
// third party is asked. This checks the transport: who may ask, what is
// refused, what an answer holds and never holds, and the limit.
const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const radii = [1000, 2000, 3000, 5000, 10000, 20000, 50000, 100000];

async function person(label) {
  const response = await fetch(base + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: base },
    body: JSON.stringify({
      ...testConsents,
      name: "Геопоиск " + label,
      email: randomUUID() + "@example.test",
      password: "geocode-test-secret-123",
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const cookie = response.headers.get("set-cookie").split(";")[0];
  return async (query, { method = "GET" } = {}) => {
    const reply = await fetch(base + "/api/geocode" + query, {
      method,
      headers: { cookie, origin: base },
    });
    return {
      status: reply.status,
      headers: reply.headers,
      body: await reply.json(),
    };
  };
}
const ask = (words) => "?q=" + encodeURIComponent(words);

const asker = await person("a");
const guest = await fetch(base + "/api/geocode" + ask("парк"));
assert.equal(guest.status, 401, "a guest has no area to place");
assert.equal(guest.headers.get("cache-control"), "no-store");

const found = await asker(ask("измайл"));
assert.equal(found.status, 200);
assert.equal(found.headers.get("cache-control"), "no-store");
assert.deepEqual(Object.keys(found.body), ["places"]);
assert.equal(found.body.places.length, 1);
const [park] = found.body.places;
assert.deepEqual(
  Object.keys(park).sort(),
  ["center", "detail", "label", "radiusM"],
  "a name, a line that tells it apart, a coarse area: nothing else",
);
assert.equal(park.label, "Измайловский парк");
assert.deepEqual(park.center, [37.75, 55.79], "a coarse centre");
assert.ok(radii.includes(park.radiusM), "a radius the area accepts");
assert.ok(
  !JSON.stringify(found.body).includes("измайл"),
  "the question is not echoed back",
);

assert.deepEqual((await asker(ask("и"))).body, { places: [] }, "too short");
assert.deepEqual(
  (await asker(ask("нигде такого нет"))).body,
  { places: [] },
  "nothing found is an answer, not an error",
);
assert.equal((await asker(ask("а".repeat(101)))).status, 400, "too long");
assert.equal(
  (await asker("?q=парк&lat=55.7&lon=37.6")).status,
  400,
  "a position is not a parameter of the search",
);
assert.equal((await asker("", { method: "POST" })).status, 405);

// A failing service is a short message that does not repeat what was asked.
const broken = await asker(ask("сбой личный-запрос"));
assert.equal(broken.status, 502);
assert.equal(typeof broken.body.error, "string");
assert.ok(
  !broken.body.error.includes("личный-запрос"),
  "the question stays out of the message",
);

// 60 questions in 15 minutes for one person; the next is told to wait.
const eager = await person("b");
for (let i = 0; i < 60; i++)
  assert.equal((await eager(ask("парк"))).status, 200, "question " + i);
assert.equal((await eager(ask("парк"))).status, 429);
assert.equal(
  (await asker(ask("парк"))).status,
  200,
  "the limit is the person's own",
);
console.log("geocode http ok");
