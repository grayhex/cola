import test from "node:test";
import assert from "node:assert/strict";
import { gamificationAssetIds, gameAssetsExist, gameAssetInUse, withGameArtwork } from "../lib/gamification-assets.js";
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";

test("artwork IDs include disabled records and locked awards, deduplicated", () => {
  assert.deepEqual(gamificationAssetIds({ enabledRecords: [], recordImages: { budget: b, expensive: a }, achievementImages: { first_public: a, full_build: null } }), [a, b]);
  assert.deepEqual(gamificationAssetIds(), []);
});
test("saving artwork locks referenced rows in a stable order and one query", async () => {
  let calls = 0;
  const q = { async query(sql, values) {
    calls++;
    assert.match(sql, /ORDER BY id FOR SHARE$/);
    assert.match(sql, /\$1::uuid\[\]/);
    assert.deepEqual(values, [[a, b]]);
    return { rows: [{ id: a }, { id: b }] };
  } };
  assert.equal(await gameAssetsExist(q, { recordImages: { expensive: b, budget: a } }), true);
  assert.equal(calls, 1);
});
test("missing or deleted image rejects the settings update", async () => {
  assert.equal(await gameAssetsExist({ query: async () => ({ rows: [] }) }, { achievementImages: { first_public: a } }), false);
});
test("empty image maps require no database query", async () => {
  assert.equal(await gameAssetsExist({ query() { throw new Error("unneeded query"); } }, { recordImages: {}, achievementImages: {} }), true);
});
test("media deletion detects achievement references and permits reset files", async () => {
  const q = { query: async () => ({ rows: [{ value: { recordImages: {}, achievementImages: { full_build: a } } }] }) };
  assert.equal(await gameAssetInUse(q, a), true);
  assert.equal(await gameAssetInUse(q, b), false);
  assert.equal(await gameAssetInUse({ query: async () => ({ rows: [] }) }, a), false);
});
test("artwork decorates only already-authorized DTOs without inventing holders or awards", () => {
  const data = { records: [{ key: "budget", holder: null }], awards: [{ key: "first_public", bikeId: null }], locked: [{ key: "full_build", progress: null }] };
  const result = withGameArtwork(data, { recordImages: { budget: a, expensive: b }, achievementImages: { first_public: b, full_build: a } });
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].holder, null);
  assert.equal(result.records[0].imageId, a);
  assert.equal(result.awards[0].imageId, b);
  assert.equal(result.locked[0].imageId, a);
  assert.equal(result.locked[0].progress, null);
  assert.equal(data.records[0].imageId, undefined);
});
test("legacy settings keep the built-in fallback and absent fields absent", () => {
  assert.deepEqual(withGameArtwork({ awards: [{ key: "first_public" }] }, {}), { awards: [{ key: "first_public", imageId: null }] });
});
