import test from "node:test";
import assert from "node:assert/strict";
import {
  significantBadge,
  metricSegments,
  buildTags,
} from "../lib/card-presentation.js";
import { plural } from "../lib/plural.js";
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
test("home card tags: groupset before frame, build parts only, at most two", () => {
  const part = (category, name, section = "build") => ({
    category,
    name,
    section,
  });
  assert.deepEqual(
    buildTags([
      part("Седло", "Selle Italia SLR"),
      part("Рама", "Cube Nuroad C:62"),
      part("Велокомпьютер", "Garmin Edge 540", "accessories"),
      part("Групсет", " Shimano GRX 820 "),
    ]),
    ["Shimano GRX 820", "Cube Nuroad C:62"],
  );
  assert.deepEqual(buildTags([part("Седло", "  ")]), []);
  assert.deepEqual(buildTags(), []);
});
test("Russian plural forms", () => {
  const bikes = (n) => plural(n, "сборка", "сборки", "сборок");
  assert.deepEqual(
    [0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(bikes),
    [
      "сборок",
      "сборка",
      "сборки",
      "сборки",
      "сборок",
      "сборок",
      "сборок",
      "сборок",
      "сборка",
      "сборки",
      "сборок",
      "сборка",
      "сборок",
    ],
  );
});
