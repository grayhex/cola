import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
// Requires the disposable test DB and services/bike-resolver/tests/fixture-server.ts:
// Canyon and Giant answer from the recorded pages of the Reddit 10 benchmark
// (services/bike-resolver/tests/fixtures/reddit10), VeloSklad refuses (403) and
// the search engine is down. Never run against production.
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
const person = session();
const user = (
  await person.api("auth/register", "POST", {
    ...testConsents,
    email: "reddit10-" + randomUUID() + "@example.test",
    name: "Reddit 10 test",
    password: "colabike-test-12345",
  })
).data.user;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const newBike = async (fields) =>
  (
    await person.api("bikes", "POST", {
      trim: "",
      name: fields.model,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: null,
      ...fields,
    })
  ).data.id;
try {
  // «Canyon Grail SLX AXS»: the current page and an outlet listing of the same
  // model are two choices with their own years; each is its own specification.
  const grail = {
    brand: "Canyon",
    model: "Grail",
    trim: "SLX AXS",
    year: null,
  };
  const offered = await person.stream("bikes/resolve-stream", {
    ...grail,
    chooseCandidates: true,
  });
  assert.equal(offered.status, 200);
  assert(offered.items.length < 60, "trace length " + offered.items.length);
  const choices = offered.items.at(-1).result;
  assert.equal(choices.status, "ambiguous");
  assert.deepEqual(
    choices.candidates.map((c) => [c.kind, c.canonicalName, c.year]),
    [
      ["manufacturer", "Grail CF SLX 8 AXS", 2027],
      ["manufacturer", "Grail CF SLX 8 AXS", 2024],
    ],
  );
  // One official source, read to the end: the search is complete.
  assert.equal(choices.search.complete, true);
  const current = choices.candidates[0],
    outlet = choices.candidates[1];
  assert.match(outlet.url, /\/outlet-bikes\//);

  const chosen = await person.stream("bikes/resolve-stream", {
    ...grail,
    candidateId: current.candidateId,
  });
  const specification = chosen.items.at(-1).result;
  assert.equal(specification.status, "resolved");
  assert.equal(specification.source.kind, "manufacturer");
  assert.equal(specification.source.url, current.url);
  assert.equal(specification.sourceYear, 2027);
  assert(specification.components.length >= 15);
  assert(
    specification.components.every(
      (c) => c.provenance.sourceUrl === current.url,
    ),
  );
  // The page was read while searching: choosing it asks nobody again.
  assert(
    !chosen.items.some((i) => i.event === "document_fetch_started"),
    "a chosen candidate is not read twice",
  );
  assert(specification.previewId);
  const preview = await db.query(
    "SELECT owner_id,response->>'sourceYear' AS year FROM resolver_previews WHERE id=$1",
    [specification.previewId],
  );
  assert.equal(preview.rows[0].owner_id, user.id);
  assert.equal(preview.rows[0].year, "2027");

  // Import: one specification with its provenance, once; the other variant
  // goes into another bike and never mixes into this one.
  const first = await newBike({ ...grail, year: 2027 });
  const imported = await person.api(
    "bikes/" + first + "/factory-spec",
    "POST",
    {
      candidateId: current.candidateId,
      initializeCurrent: true,
    },
  );
  assert.equal(imported.data.status, "resolved");
  assert(imported.data.importedCount >= 15);
  const saved = (await person.api("bikes/" + first)).data.bike;
  assert.equal(saved.components.length, imported.data.importedCount);
  assert.equal(saved.factory_spec.source.kind, "manufacturer");
  assert.equal(saved.factory_spec.source.url, current.url);
  assert.equal(saved.factory_spec.sourceYear, 2027);
  assert.equal(
    (
      await person.api("bikes/" + first + "/factory-spec", "POST", {
        candidateId: current.candidateId,
        initializeCurrent: true,
      })
    ).data.importedCount,
    0,
    "a second import adds nothing",
  );
  const second = await newBike({ ...grail, year: 2024 });
  const other = await person.api("bikes/" + second + "/factory-spec", "POST", {
    candidateId: outlet.candidateId,
    initializeCurrent: true,
  });
  assert.equal(other.data.status, "resolved");
  const savedOutlet = (await person.api("bikes/" + second)).data.bike;
  assert.equal(savedOutlet.factory_spec.source.url, outlet.url);
  assert.equal(savedOutlet.factory_spec.sourceYear, 2024);
  assert.equal(
    (await person.api("bikes/" + first)).data.bike.factory_spec.source.url,
    current.url,
    "the first bike keeps its own specification",
  );

  // «Giant Revolt 2»: one official page is still a choice, never an import by itself.
  const revolt = { brand: "Giant", model: "Revolt", trim: "2", year: null };
  const giant = (
    await person.stream("bikes/resolve-stream", {
      ...revolt,
      chooseCandidates: true,
    })
  ).items.at(-1).result;
  assert.equal(giant.status, "ambiguous");
  assert.equal(giant.candidates.length, 1);
  assert.equal(giant.candidates[0].year, 2026);
  assert.equal(giant.candidates[0].selectable, true);
  const revoltChosen = (
    await person.stream("bikes/resolve-stream", {
      ...revolt,
      candidateId: giant.candidates[0].candidateId,
    })
  ).items.at(-1).result;
  assert.equal(revoltChosen.status, "resolved");
  assert.equal(revoltChosen.sourceYear, 2026);
  assert(revoltChosen.components.length >= 18);

  // «Canyon Grizl CF SL 6 2023»: no source has a 2023 page. The current pages are
  // offered as variants, each flagged as not the bike asked for; the shop that
  // refuses and the search engine that is down are said, and hide nothing.
  const grizl = {
    brand: "Canyon",
    model: "Grizl",
    trim: "CF SL 6",
    year: 2023,
  };
  const variants = (
    await person.stream("bikes/resolve-stream", {
      ...grizl,
      chooseCandidates: true,
    })
  ).items.at(-1).result;
  assert.equal(variants.status, "ambiguous");
  assert.equal(variants.candidates.length, 6);
  for (const c of variants.candidates) {
    assert(c.warnings.includes("identity_mismatch"), c.canonicalName);
    assert.notEqual(c.year, 2023, "no page is called 2023");
  }
  const sources = Object.fromEntries(
    variants.search.sources.map((s) => [s.id, s]),
  );
  assert.equal(sources.canyon.status, "ok");
  assert.equal(sources.velosklad.status, "blocked");
  assert.equal(sources.web.status, "timeout");
  assert.equal(variants.search.complete, false);

  // The same page, pasted by the person: read as their own choice.
  const pasted = (
    await person.api("bikes/resolve", "POST", {
      brand: "Canyon",
      model: "Grizl",
      trim: "CF SLX 8",
      year: null,
      sourceUrl:
        "https://www.canyon.com/en-nl/outlet-bikes/gravel-bikes/grizl-cf-slx-8-axs-trail/50039723.html",
    })
  ).data;
  assert.equal(pasted.status, "resolved");
  assert.equal(pasted.source.kind, "manual");
  assert.equal(pasted.sourceYear, 2024);
  assert(pasted.components.length >= 15);

  for (const id of [first, second]) await person.api("bikes/" + id, "DELETE");
} finally {
  await db.query("DELETE FROM users WHERE id=$1", [user.id]);
  await db.end();
}
console.log(
  "Resolver Reddit 10 HTTP: official variants chosen by id, own year and provenance per import, one page still a choice, historical request flagged, pasted page read passed.",
);
