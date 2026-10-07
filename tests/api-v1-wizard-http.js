// API v1, the wizard of a new bicycle (#57 of the Android client), through the
// real server, PostgreSQL and the fixture Resolver: the dictionaries of the site
// without signing in, the search of a build by a page and by the variants the
// service offers, and the creation with the build the person has checked: the
// source kept, the identity confirmed, a replay that makes no second bicycle.
// The rules are the site's (tests/wizard-http.js); this checks that the
// transport keeps them with a Bearer device session.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { testConsents } from "./fixtures/legal.js";
import { verifyCapturedEmail } from "./fixtures/verified-user.js";
import {
  bikeResolutionSchema,
  bikeSchema,
  errorSchema,
  siteCatalogSchema,
} from "../lib/api-v1/schemas.ts";

const base = process.env.TEST_ORIGIN || "http://localhost:3100";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const run = randomUUID().slice(0, 8);
const password = "wizard-api-http-password-123";

async function http(path, { method = "GET", headers = {}, body, origin } = {}) {
  const response = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(origin === undefined ? {} : { origin }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    status: response.status,
    body: json,
    text,
    headers: response.headers,
  };
}
async function member(label, verified = true) {
  const email = `wizard-api-${label}-${run}@example.test`;
  const registered = await http("/api/auth/register", {
    method: "POST",
    origin: base,
    body: {
      ...testConsents,
      name: "Райдер " + label,
      email,
      password,
    },
  });
  assert.equal(registered.status, 201, registered.text);
  if (verified) await verifyCapturedEmail(email);
  const grant = await http("/api/v1/auth/sessions", {
    method: "POST",
    body: {
      email,
      password,
      device: { name: "Телефон " + label, platform: "android" },
    },
  });
  assert.equal(grant.status, 201, grant.text);
  return {
    id: registered.body.user.id,
    token: (path, options = {}) =>
      http("/api/v1" + path, {
        ...options,
        headers: {
          authorization: "Bearer " + grant.body.accessToken,
          ...(options.headers ?? {}),
        },
      }),
  };
}
const guest = (path, options = {}) => http("/api/v1" + path, options);
function assertError(r, status, code, label) {
  assert.equal(r.status, status, label + " " + r.text);
  assert.deepEqual(errorSchema.parse(r.body), r.body, label);
  assert.equal(r.body.error.code, code, label);
}
const key = () => ({ "Idempotency-Key": randomUUID() });
const classification = {
  category: "urban_touring",
  subtype: "trekking",
  suspension: null,
  construction: null,
  uses: [],
  electric: false,
  fatbike: false,
};
const identity = { brand: "Giant", model: "Tourer", trim: "GTS", year: 2024 };
const page = "https://www.velo-port.ru/test-bike";
const wizardBody = (overrides = {}) => ({
  bike: { ...identity, classification, isPublic: false, mileage: 750 },
  components: [
    {
      section: "build",
      category: "Седло",
      name: "Edited saddle",
      notes: "",
      price: 5000,
    },
  ],
  ...overrides,
});
const bikeCount = async (owner) =>
  Number(
    (await db.query("SELECT count(*) FROM bikes WHERE owner_id=$1", [owner]))
      .rows[0].count,
  );

try {
  const owner = await member("owner");
  const other = await member("other");
  const mailless = await member("mailless", false);

  // ---- The dictionaries: readable by everyone, cached by their content ------
  const catalog = await guest("/catalog");
  assert.equal(catalog.status, 200, catalog.text);
  assert.deepEqual(siteCatalogSchema.parse(catalog.body), catalog.body);
  assert.equal(catalog.headers.get("cache-control"), "public, max-age=60");
  assert.ok(catalog.body.brands.some((b) => b.name === "Giant"));
  assert.ok(
    catalog.body.classification.categories.some(
      (c) => c.key === "urban_touring" && c.subtypes.length > 0,
    ),
  );
  assert.ok(catalog.body.components.groups.length > 0);
  const etag = catalog.headers.get("etag");
  assert.match(etag, /^"site-catalog-/);
  const unchanged = await guest("/catalog", {
    headers: { "If-None-Match": etag },
  });
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.text, "");
  // A device token or a broken one changes nothing: the answer is the same for all.
  assert.deepEqual((await owner.token("/catalog")).body, catalog.body);
  assert.equal(
    (
      await guest("/catalog", {
        headers: { authorization: "Bearer cola_at_nonsense" },
      })
    ).status,
    200,
  );
  assertError(
    await guest("/catalog", { method: "POST", body: {} }),
    405,
    "method_not_allowed",
    "catalog is read-only",
  );

  // ---- Who may search, and what a request has to be ---------------------------
  assertError(
    await guest("/bike-resolutions", { method: "POST", body: identity }),
    401,
    "unauthorized",
    "guest searching",
  );
  assertError(
    await owner.token("/bike-resolutions", {
      method: "POST",
      body: { ...identity, sourceUrl: "ftp://shop.example/x" },
    }),
    400,
    "invalid_request",
    "not an http page",
  );
  assertError(
    await owner.token("/bike-resolutions", {
      method: "POST",
      body: {
        ...identity,
        candidateId: "a".repeat(64),
        chooseCandidates: true,
      },
    }),
    400,
    "invalid_request",
    "two ways at once",
  );

  // ---- A page of a shop: one build, a preview that belongs to the searcher ---
  const found = await owner.token("/bike-resolutions", {
    method: "POST",
    body: { ...identity, sourceUrl: page },
  });
  assert.equal(found.status, 200, found.text);
  assert.deepEqual(bikeResolutionSchema.parse(found.body), found.body);
  assert.equal(found.body.status, "resolved");
  assert.ok(found.body.previewId);
  assert.equal(found.body.build.components.length, 3);
  assert.ok(
    found.body.build.components.every((c) => c.section && c.category && c.name),
  );
  assert.equal(found.body.build.sourceUrl, page);
  assert.equal(found.body.build.manualSelection, true);
  const stored = (
    await db.query(
      "SELECT owner_id,response->'source'->>'url' AS url FROM resolver_previews WHERE id=$1",
      [found.body.previewId],
    )
  ).rows[0];
  assert.equal(stored.owner_id, owner.id);
  assert.equal(stored.url, page);

  // ---- Variants: the person chooses by the id the service gave ---------------
  const stores = {
    brand: "Focus",
    model: "Atlas 6.7 Cues",
    trim: null,
    year: null,
  };
  const offered = await owner.token("/bike-resolutions", {
    method: "POST",
    body: { ...stores, chooseCandidates: true },
  });
  assert.equal(offered.status, 200, offered.text);
  assert.deepEqual(bikeResolutionSchema.parse(offered.body), offered.body);
  assert.equal(offered.body.status, "ambiguous");
  assert.equal(offered.body.previewId, null);
  const candidate = offered.body.candidates.find(
    (c) => c.sourceKind === "store",
  );
  assert.ok(candidate, offered.text);
  assert.equal(candidate.selectable, true);
  assert.equal(
    candidate.year,
    null,
    "the page names no year: none is invented",
  );
  assert.ok(candidate.candidateId);
  assert.equal(offered.body.sourcesChecked.complete, false);
  const chosen = await owner.token("/bike-resolutions", {
    method: "POST",
    body: { ...stores, candidateId: candidate.candidateId },
  });
  assert.equal(chosen.body.status, "resolved", chosen.text);
  assert.equal(chosen.body.build.sourceKind, "store");
  assert.ok(chosen.body.build.components.length >= 15);
  assert.equal(chosen.body.build.sourceYear, null);
  // An id nobody offered is no fresh automatic pick: it is said so.
  const stale = await owner.token("/bike-resolutions", {
    method: "POST",
    body: { ...stores, candidateId: "f".repeat(64) },
  });
  assert.equal(stale.status, 200);
  assert.equal(stale.body.status, "not_found");
  assert.equal(stale.body.reason, "candidate_expired");
  assert.equal(stale.body.retryable, true);
  assert.deepEqual(stale.body.candidates, []);

  // ---- Creation: the checked build is saved, the source with it --------------
  assertError(
    await owner.token("/bike-wizard/bikes", {
      method: "POST",
      body: wizardBody(),
    }),
    400,
    "invalid_request",
    "no key",
  );
  assertError(
    await guest("/bike-wizard/bikes", {
      method: "POST",
      body: wizardBody(),
      headers: key(),
    }),
    401,
    "unauthorized",
    "guest creating",
  );
  assertError(
    await mailless.token("/bike-wizard/bikes", {
      method: "POST",
      body: wizardBody({ bike: { ...wizardBody().bike, isPublic: true } }),
      headers: key(),
    }),
    403,
    "email_verification_required",
    "publishing needs a confirmed address",
  );
  const before = await bikeCount(owner.id);
  const idempotency = key();
  const created = await owner.token("/bike-wizard/bikes", {
    method: "POST",
    body: wizardBody({ previewId: found.body.previewId }),
    headers: idempotency,
  });
  assert.equal(created.status, 201, created.text);
  assert.deepEqual(bikeSchema.parse(created.body), created.body);
  assert.ok(created.headers.get("etag"));
  assert.equal(
    created.body.name,
    "Giant Tourer GTS 2024",
    "no name: the model's",
  );
  assert.equal(created.body.mileage, 750);
  assert.equal(created.body.isPublic, false);
  assert.equal(created.body.classification.subtype, "trekking");
  assert.equal(
    created.body.components.length,
    1,
    "the build is the checked one",
  );
  assert.equal(created.body.components[0].name, "Edited saddle");
  const spec = (
    await db.query("SELECT factory_spec FROM bikes WHERE id=$1", [
      created.body.id,
    ])
  ).rows[0].factory_spec;
  assert.equal(spec.source.url, page, "the source stays with the bicycle");
  assert.equal(spec.components.length, 3, "and the factory specification");

  // A lost answer asked again is the same bicycle, never a second one.
  const replay = await owner.token("/bike-wizard/bikes", {
    method: "POST",
    body: wizardBody({ previewId: found.body.previewId }),
    headers: idempotency,
  });
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.equal(replay.body.id, created.body.id);
  assert.equal(await bikeCount(owner.id), before + 1);
  assertError(
    await owner.token("/bike-wizard/bikes", {
      method: "POST",
      body: wizardBody({ components: [] }),
      headers: idempotency,
    }),
    409,
    "conflict",
    "the same key, another body",
  );
  assert.equal(await bikeCount(owner.id), before + 1);

  // The bicycle is private: only its owner reads it.
  assert.equal((await other.token("/bikes/" + created.body.id)).status, 404);
  assert.equal((await owner.token("/bikes/" + created.body.id)).status, 200);

  // A preview is its searcher's: another person cannot turn it into a bicycle.
  const foreign = await other.token("/bike-wizard/bikes", {
    method: "POST",
    body: wizardBody({ previewId: found.body.previewId }),
    headers: key(),
  });
  assertError(foreign, 409, "conflict", "someone else's preview");
  assert.equal(foreign.body.error.details[0].path, "previewId");
  assert.equal(
    (await db.query("SELECT count(*) FROM bikes WHERE owner_id=$1", [other.id]))
      .rows[0].count,
    "0",
  );
  // A preview that never existed is the same refusal.
  assertError(
    await owner.token("/bike-wizard/bikes", {
      method: "POST",
      body: wizardBody({ previewId: randomUUID() }),
      headers: key(),
    }),
    409,
    "conflict",
    "unknown preview",
  );

  // ---- Another year than the page's needs the person's word ------------------
  const otherYear = wizardBody({
    previewId: found.body.previewId,
    bike: { ...wizardBody().bike, year: 2025 },
  });
  const unconfirmed = await owner.token("/bike-wizard/bikes", {
    method: "POST",
    body: otherYear,
    headers: key(),
  });
  assertError(unconfirmed, 409, "conflict", "year differs");
  assert.equal(unconfirmed.body.error.details[0].path, "identityConfirmed");
  assert.equal(await bikeCount(owner.id), before + 1, "nothing was made");
  const confirmed = await owner.token("/bike-wizard/bikes", {
    method: "POST",
    body: { ...otherYear, identityConfirmed: true },
    headers: key(),
  });
  assert.equal(confirmed.status, 201, confirmed.text);
  assert.equal(confirmed.body.year, 2025);
  const kept = (
    await db.query("SELECT factory_spec FROM bikes WHERE id=$1", [
      confirmed.body.id,
    ])
  ).rows[0].factory_spec;
  assert.equal(kept.query.year, 2024, "what the source was asked stays");

  // ---- By hand: no preview, no source, a name of the person's own ------------
  const manual = await owner.token("/bike-wizard/bikes", {
    method: "POST",
    body: wizardBody({
      bike: { ...wizardBody().bike, name: "  Мой туринг  " },
      components: [],
    }),
    headers: key(),
  });
  assert.equal(manual.status, 201, manual.text);
  assert.equal(manual.body.name, "Мой туринг");
  assert.equal(manual.body.components.length, 0);
  assert.equal(
    (
      await db.query("SELECT factory_spec FROM bikes WHERE id=$1", [
        manual.body.id,
      ])
    ).rows[0].factory_spec,
    null,
  );
  assertError(
    await owner.token("/bike-wizard/bikes", {
      method: "POST",
      body: wizardBody({
        bike: {
          ...wizardBody().bike,
          classification: { ...classification, subtype: "xc" },
        },
      }),
      headers: key(),
    }),
    400,
    "invalid_request",
    "a subtype of another category",
  );

  for (const id of [created.body.id, confirmed.body.id, manual.body.id])
    await owner.token("/bikes/" + id, { method: "DELETE" });
  console.log(
    "API v1 wizard HTTP: dictionaries with a validator, search by page and by variants, preview ownership, identity confirmation, replay and by-hand creation passed.",
  );
} finally {
  await db.end();
}
