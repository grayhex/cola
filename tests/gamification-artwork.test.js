import test from "node:test";
import assert from "node:assert/strict";
import { gameAssetInUse } from "../lib/gamification-assets.js";
const a = "00000000-0000-4000-8000-000000000001";

// #106: an illustration belongs to a rule, switched off or not; the media
// library must not delete it.
test("media deletion asks the rules, including switched-off ones", async () => {
  const q = {
    async query(sql, values) {
      assert.match(sql, /FROM game_rules WHERE image_id=\$1/);
      assert.doesNotMatch(sql, /enabled/);
      return { rows: values[0] === a ? [{ "?column?": 1 }] : [] };
    },
  };
  assert.equal(await gameAssetInUse(q, a), true);
  assert.equal(
    await gameAssetInUse(q, "00000000-0000-4000-8000-000000000002"),
    false,
  );
});

test("artwork normalizes IDs and historical local asset paths into bounded variants", async () => {
  const { gameArtworkSource } = await import("../lib/gamification-assets.js");
  assert.equal(gameArtworkSource(a), `/api/assets/${a}?width=160`);
  assert.equal(
    gameArtworkSource(`/api/assets/${a}`, 56),
    `/api/assets/${a}?width=320`,
  );
  assert.equal(
    gameArtworkSource(`/api/assets/${a}?width=1280`, 64),
    `/api/assets/${a}?width=320`,
  );
  for (const invalid of [
    null,
    {},
    "",
    `https://other.test/api/assets/${a}`,
    "../private",
    `${a}?other=1`,
  ])
    assert.equal(gameArtworkSource(invalid), null);
});
