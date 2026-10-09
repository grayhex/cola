// Recorded external pages, real resolver/proxy/preview/database import.
import { verifiedFetch as fetch } from "./fixtures/verified-user.js";
import { testConsents } from "./fixtures/legal.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
const base = process.env.TEST_ORIGIN || "http://localhost:3000";
function session() {
  let cookie = "";
  return async (path, data) => {
    const response = await fetch(base + "/api/" + path, {
      method: data ? "POST" : "GET",
      headers: { origin: base, cookie, "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    const text = await response.text();
    const items =
      path.endsWith("resolve-stream") && response.ok
        ? text
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        : [];
    return {
      status: response.status,
      data: items.length ? items.at(-1).result : JSON.parse(text),
      items,
    };
  };
}
const owner = session(),
  other = session();
const register = async (api) =>
  (
    await api("auth/register", {
      ...testConsents,
      email: "russian-" + randomUUID() + "@example.test",
      name: "Source integration",
      password: "colabike-test-12345",
    })
  ).data.user;
const user = await register(owner),
  stranger = await register(other);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const cases = [
    { brand: "Superior", model: "RR 9.5", year: 2025, store: "alienbike" },
    { brand: "ASPECT", model: "RONIN PRO 29", year: 2025, adapter: "aspect" },
    {
      brand: "STELS",
      model: "Navigator 870 V",
      year: 2016,
      adapter: "stels",
      kind: "archive",
    },
  ];
  for (const item of cases) {
    const query = {
      brand: item.brand,
      model: item.model,
      year: item.year,
      trim: null,
    };
    const offered = await owner("bikes/resolve-stream", {
      ...query,
      chooseCandidates: true,
    });
    assert.equal(offered.status, 200);
    assert.equal(
      offered.data.status,
      "ambiguous",
      JSON.stringify(offered.data),
    );
    assert(offered.items.length < 60);
    const candidates = offered.data.candidates;
    if (item.store)
      assert.deepEqual(
        new Set(
          candidates
            .filter((c) => ["alienbike", "velodrive"].includes(c.storeId))
            .map((c) => c.storeId),
        ),
        new Set(["alienbike", "velodrive"]),
      );
    const candidate = candidates.find((c) =>
      item.store
        ? c.storeId === item.store
        : c.year === item.year && c.kind === (item.kind || "manufacturer"),
    );
    assert(candidate, JSON.stringify(candidates));
    assert.match(candidate.candidateId, /^[a-f0-9]{64}$/);
    const selected = await owner("bikes/resolve-stream", {
      ...query,
      candidateId: candidate.candidateId,
    });
    const result = selected.data;
    assert.equal(result.status, "resolved");
    assert.equal(
      result.source.kind,
      item.kind || (item.store ? "store" : "manufacturer"),
    );
    assert.equal(result.sourceYear, item.year);
    assert(result.components.length >= 12);
    assert(result.previewId);
    assert(!selected.items.some((event) => event.event === "store_checked"));
    const preview = await db.query(
      "SELECT owner_id FROM resolver_previews WHERE id=$1",
      [result.previewId],
    );
    assert.equal(preview.rows[0].owner_id, user.id);
    const bike = {
      ...query,
      trim: "",
      name: item.model,
      category: "gravel",
      description: "",
      color: "",
      size: "",
      weight: null,
    };
    const denied = await other("bikes/wizard", {
      requestId: randomUUID(),
      previewId: result.previewId,
      bike,
      components: [],
    });
    assert.equal(denied.status, 409, JSON.stringify(denied.data));
    const created = await owner("bikes", bike);
    assert(created.data.id, JSON.stringify(created.data));
    const id = created.data.id;
    const payload = {
      candidateId: candidate.candidateId,
      initializeCurrent: true,
    };
    const imported = await owner(`bikes/${id}/factory-spec`, payload);
    assert.equal(
      imported.data.status,
      "resolved",
      JSON.stringify(imported.data),
    );
    assert(imported.data.importedCount >= 12);
    const saved = (await owner(`bikes/${id}`)).data.bike;
    assert.equal(saved.factory_spec.source.url, result.source.url);
    assert.equal(saved.factory_spec.source.kind, result.source.kind);
    assert.equal(saved.components.length, imported.data.importedCount);
    assert(
      saved.factory_spec.components.every(
        (c) => c.provenance.sourceUrl === result.source.url,
      ),
    );
    await db.query(
      "UPDATE components SET name='Owner custom part',price=1234 WHERE id=$1",
      [saved.components[0].id],
    );
    assert.equal(
      (await owner(`bikes/${id}/factory-spec`, payload)).data.importedCount,
      0,
    );
    const preserved = await db.query(
      "SELECT name,price FROM components WHERE id=$1",
      [saved.components[0].id],
    );
    assert.equal(preserved.rows[0].name, "Owner custom part");
    assert.equal(Number(preserved.rows[0].price), 1234);
  }
  console.log(
    "Russian sources: multi-store NDJSON, opaque selection, owner preview, archive provenance and idempotent import passed",
  );
} finally {
  await db.query("DELETE FROM users WHERE id IN ($1,$2)", [
    user.id,
    stranger.id,
  ]);
  await db.end();
}
