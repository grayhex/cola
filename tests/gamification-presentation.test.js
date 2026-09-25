import test from "node:test";
import assert from "node:assert/strict";
import {
  groupByMetric,
  groupRecords,
  homeRecords,
  ruleCondition,
} from "../lib/gamification-presentation.js";
import { metricGroups, metricValue } from "../lib/game-metrics.js";

test("records and awards come in the groups of their metrics; nothing is lost", () => {
  const items = [
    { key: "marathon", group: "rides" },
    { key: "expensive", group: "price" },
    { key: "popular", group: "community" },
    { key: "budget", group: "price" },
    { key: "future", group: "future" },
  ];
  const groups = groupByMetric(items);
  assert.deepEqual(
    groups.map((g) => g.id),
    ["price", "rides", "community", "other"],
  );
  assert.deepEqual(
    groups.map((g) => g.items.map((i) => i.key)),
    [["expensive", "budget"], ["marathon"], ["popular"], ["future"]],
  );
  assert.equal(groups[0].name, metricGroups[0].name);
  assert.deepEqual(groupByMetric([]), []);
  assert.deepEqual(groupRecords(items)[0].records, [items[1], items[3]]);
});
test("the home block keeps rides and riders next to prices and weights", () => {
  const bike = (key) => ({ key, subject: "bike", holder: { kind: "bike" } });
  const ride = (key) => ({ key, subject: "ride", holder: { kind: "ride" } });
  const vacant = { key: "vacant", subject: "ride", holder: null };
  const keys = (list) => list.map((r) => r.key);
  const bikes = ["expensive", "budget", "light", "heavy", "veteran"].map(bike);
  assert.deepEqual(keys(homeRecords(bikes)), [
    "expensive",
    "budget",
    "light",
    "heavy",
  ]);
  const all = [
    ...bikes,
    vacant,
    ride("marathon"),
    ride("climber"),
    ride("turtle"),
  ];
  assert.deepEqual(keys(homeRecords(all)), [
    "expensive",
    "budget",
    "marathon",
    "climber",
  ]);
  assert.deepEqual(
    keys(
      homeRecords([
        bikes[0],
        ride("marathon"),
        ride("climber"),
        ride("turtle"),
      ]),
    ),
    ["expensive", "marathon", "climber", "turtle"],
  );
  assert.deepEqual(homeRecords([vacant]), []);
});
test("a rule reads as its condition", () => {
  assert.equal(
    ruleCondition({
      kind: "award",
      metric: "ride_max_speed",
      comparison: "gte",
      threshold: 50,
      keywords: [],
    }),
    "Максимальная скорость (если владелец её показывает) ≥ 50 км/ч",
  );
  assert.equal(
    ruleCondition(
      {
        kind: "record",
        metric: "ride_avg_speed",
        direction: "min",
        minDistanceKm: 10,
        category: "mtb",
        keywords: [],
      },
      { mtb: "MTB" },
    ),
    "Минимум: средняя скорость покатушки · MTB · от 10 км",
  );
  assert.equal(
    ruleCondition({
      kind: "award",
      metric: "keywords",
      comparison: "gte",
      threshold: 1,
      keywords: ["Di2", "AXS"],
    }),
    "Детали с ключевыми словами в названии ≥ 1 шт. · Di2, AXS",
  );
  assert.equal(ruleCondition({ kind: "award", metric: "unknown" }), "");
});
test("values carry their units", () => {
  assert.equal(metricValue("ride_distance", 123.456), "123,46 км");
  assert.equal(metricValue("year", 1998), "1998");
  assert.equal(metricValue("completeness", 85), "85%");
  assert.equal(metricValue("price", 250000).replace(/\s/g, " "), "250 000 ₽");
  assert.equal(metricValue("followers", 12), "12");
  assert.equal(metricValue("weight", null), "");
  assert.equal(metricValue("unknown", 5), "");
});
