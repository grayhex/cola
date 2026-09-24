import test from "node:test";
import assert from "node:assert/strict";
import { significantBadge, metricSegments } from "../lib/card-presentation.js";
test("card status selects one current record, then rare milestone, then community title", () => {
  const rare = { key: "bike_likes_50", name: "50 сердец" };
  const bike = {
    id: "a",
    is_public: true,
    badges: [{ key: "bike_likes_10" }, rare],
  };
  const record = { key: "lightest_road", group: "Вес", holder: { id: "a" } };
  const community = { key: "dream", group: "Community", holder: { id: "a" } };
  assert.equal(significantBadge(bike, [community, record]), record);
  assert.equal(significantBadge(bike, [community]), rare);
  assert.equal(
    significantBadge({ ...bike, badges: [] }, [community]),
    community,
  );
  assert.equal(significantBadge({ ...bike, is_public: false }, [record]), null);
  assert.equal(
    significantBadge({ ...bike, badges: [] }, [
      { ...record, holder: { id: "b" } },
    ]),
    null,
  );
  assert.equal(
    significantBadge({ ...bike, badges: [{ key: "bike_likes_10" }] }, []),
    null,
  );
});
test("four compact segments preserve documented boundaries; exact score is shown separately", () => {
  for (const [percent, expected] of [
    [0, 1],
    [24, 1],
    [25, 2],
    [49, 2],
    [50, 3],
    [74, 3],
    [75, 4],
    [100, 4],
    [-5, 1],
    [150, 4],
  ])
    assert.equal(metricSegments(percent), expected);
});
