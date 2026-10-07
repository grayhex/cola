import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
// Requires the disposable test DB and services/bike-resolver/tests/fixture-server.ts:
// the Bikeinn shop answers from recorded pages, VeloSklad refuses (403) and the
// search engine is down. Never run against production.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
const base = process.env.TEST_ORIGIN || "http://localhost:3000";
function session() {
  let cookie = "";
  async function api(path, method = "GET", data, origin = base) {
    const r = await fetch(base + "/api/" + path, {
      method,
      headers: { origin, cookie, "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, data: await r.json() };
  }
  async function stream(path, input) {
    const r = await fetch(base + "/api/" + path, {
      method: "POST",
      headers: { origin: base, cookie, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const text = await r.text();
    return {
      status: r.status,
      items: r.ok
        ? text
            .trim()
            .split("\n")
            .map((s) => JSON.parse(s))
        : [],
    };
  }
  return { api, stream };
}
const person = session(),
  other = session();
const register = async (s, name) =>
  (
    await s.api("auth/register", "POST", {
      ...testConsents,
      email: "stores-" + randomUUID() + "@example.test",
      name,
      password: "colabike-test-12345",
    })
  ).data.user;
const user = await register(person, "Stores test"),
  stranger = await register(other, "Stranger");
// A brand with no adapter: this can only be served through the stores.
const identity = {
  brand: "Focus",
  model: "Atlas 6.7 Cues",
  trim: null,
  year: null,
};

const offered = await person.stream("bikes/resolve-stream", {
  ...identity,
  chooseCandidates: true,
});
assert.equal(offered.status, 200);
const events = offered.items.filter((i) => i.type === "event");
// The browser proxy refuses long streams: the trace stays short however many pages were read.
assert(offered.items.length < 60, "trace length " + offered.items.length);
assert(
  events.some(
    (e) => e.event === "store_checked" && e.host === "www.tradeinn.com",
  ),
);
const choices = offered.items.at(-1).result;
assert.equal(choices.status, "ambiguous");
const candidate = choices.candidates.find((c) => c.storeId === "bikeinn");
assert(candidate, JSON.stringify(choices.candidates));
assert.equal(candidate.kind, "store");
assert.equal(candidate.selectable, true);
assert.equal(candidate.year, null, "the page states no year: none is invented");
assert.equal(candidate.canonicalName, "Focus Atlas 6.7 Cues gravel bike");
assert.equal(candidate.quality.level, "complete");
assert(candidate.drivetrain);
// One store refusing and the search engine being down hide nothing, and are said so.
const sources = Object.fromEntries(
  choices.search.sources.map((s) => [s.id, s]),
);
assert.equal(sources.bikeinn.status, "ok");
assert.equal(sources.velosklad.status, "blocked");
assert.equal(sources.velosklad.reason, "http_403");
assert.equal(sources.web.status, "timeout");
assert.equal(sources.alltricks.status, "disabled");
assert.equal(choices.search.complete, false);

// The offered page, chosen by id: stream, owner-bound preview, and no re-search.
const chosen = await person.stream("bikes/resolve-stream", {
  ...identity,
  candidateId: candidate.candidateId,
});
const specification = chosen.items.at(-1).result;
assert.equal(specification.status, "resolved");
assert.equal(specification.source.kind, "store");
assert.equal(specification.source.storeId, "bikeinn");
assert.equal(specification.source.adapter, "store:bikeinn");
assert.equal(specification.manualSelection, true);
assert.equal(specification.sourceYear, null);
assert(specification.components.length >= 15);
assert(
  specification.components.every(
    (c) => c.provenance.sourceUrl === specification.source.url,
  ),
);
assert(specification.previewId);
assert(
  !chosen.items.some((i) => i.event === "store_checked"),
  "a chosen candidate must not trigger a new search",
);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const preview = await db.query(
    "SELECT owner_id,response->'source'->>'kind' AS kind FROM resolver_previews WHERE id=$1",
    [specification.previewId],
  );
  assert.equal(preview.rows[0].owner_id, user.id);
  assert.equal(preview.rows[0].kind, "store");
  // Another person cannot turn this preview into their bike.
  const foreign = await other.api("bikes/wizard", "POST", {
    requestId: randomUUID(),
    previewId: specification.previewId,
    bike: {
      ...identity,
      trim: "",
      year: 2026,
      name: "Not mine",
      category: "road",
      description: "",
      color: "Black",
      size: "L",
      weight: null,
      mileage: 750,
    },
    components: [
      {
        section: "build",
        category: "Седло",
        name: "Edited saddle",
        notes: "",
        price: 5000,
      },
    ],
  });
  assert.equal(foreign.status, 409, JSON.stringify(foreign.data));

  // An id nobody offered is not turned into a fresh automatic pick.
  const stale = await person.api("bikes/resolve", "POST", {
    ...identity,
    candidateId: "f".repeat(64),
  });
  assert.equal(stale.data.status, "not_found");
  assert.equal(stale.data.reason, "candidate_expired");

  // Import into a bike: one specification, with its provenance, once.
  const bike = {
    brand: "Focus",
    model: "Atlas 6.7 Cues",
    trim: "",
    year: 2026,
    name: "Focus",
    category: "gravel",
    description: "",
    color: "",
    size: "",
    weight: null,
  };
  const { id } = (await person.api("bikes", "POST", bike)).data;
  const imported = await person.api("bikes/" + id + "/factory-spec", "POST", {
    candidateId: candidate.candidateId,
    initializeCurrent: true,
  });
  assert.equal(imported.data.status, "resolved");
  assert(imported.data.importedCount >= 15);
  const saved = (await person.api("bikes/" + id)).data.bike;
  assert.equal(saved.components.length, imported.data.importedCount);
  assert.equal(saved.factory_spec.source.kind, "store");
  assert.equal(saved.factory_spec.source.storeId, "bikeinn");
  assert.equal(saved.factory_spec.source.url, specification.source.url);
  assert(saved.factory_spec.sourceYear === null);
  assert.equal(
    (
      await person.api("bikes/" + id + "/factory-spec", "POST", {
        candidateId: candidate.candidateId,
        initializeCurrent: true,
      })
    ).data.importedCount,
    0,
  );

  // The brands endpoint tells direct adapters from stores, with honest limits.
  const brands = (await person.api("bikes/resolver-brands")).data;
  // The official sites are "direct"; TWITTER is read from the shop of its importer.
  assert.deepEqual(
    Object.fromEntries(
      brands.brands
        .filter((b) => b.kind !== "direct")
        .map((b) => [b.id, b.kind]),
    ),
    { twitter: "distributor" },
  );
  for (const id of ["rose", "sava", "shulz", "twitter"])
    assert(brands.brands.find((b) => b.id === id)?.enabled, id);
  assert.deepEqual(
    brands.stores.map((s) => [s.id, s.search]),
    [
      ["velosklad", true],
      ["bikeinn", true],
      ["alltricks", false],
      ["bike24", false],
    ],
  );
  assert.equal(brands.storeSearch, true);
  assert(brands.stores.find((s) => s.id === "bike24").limitation);

  // An operator can switch one store off; it is then reported, not asked.
  await db.query("UPDATE users SET role='admin' WHERE id=$1", [user.id]);
  const config = (await person.api("admin/resolver")).data;
  assert.equal(config.stores.length, 4);
  assert.equal(config.value.stores.bikeinn, true);
  assert.equal(config.value.stores.alltricks, false);
  const switched = await person.api("admin/resolver", "PUT", {
    value: {
      ...config.value,
      stores: { ...config.value.stores, bikeinn: false },
    },
    version: config.version,
  });
  assert.equal(switched.status, 200);
  const without = await person.stream("bikes/resolve-stream", {
    ...identity,
    model: "Atlas 6.7",
    chooseCandidates: true,
  });
  const none = without.items.at(-1).result;
  assert.notEqual(none.status, "ambiguous");
  assert.equal(
    none.search.sources.find((s) => s.id === "bikeinn").status,
    "disabled",
  );
  const after = (await person.api("admin/resolver")).data;
  await person.api("admin/resolver", "PUT", {
    value: config.value,
    version: after.version,
  });
  await person.api("bikes/" + id, "DELETE");
} finally {
  await db.query("DELETE FROM users WHERE id IN ($1,$2)", [
    user.id,
    stranger.id,
  ]);
  await db.end();
}
console.log(
  "Resolver stores HTTP: unknown brand via stores, independent source report, chosen candidate by id through stream, owner-bound preview, expired id, import with provenance and operator store switch passed.",
);
