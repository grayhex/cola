import test from "node:test";
import assert from "node:assert/strict";
import { ruleInput, rulesInput } from "../lib/game-rule-validation.js";
import {
  gameSettingsInput,
  gameSettings,
} from "../lib/gamification-validation.js";
import { defaultGamification } from "../lib/gamification-definitions.js";
import { gameMetrics } from "../lib/game-metrics.js";
import { gameDescriptionLimit } from "../lib/gamification-presentation.js";

const id = "00000000-0000-4000-8000-000000000001";
const award = {
  key: "rule_racer",
  kind: "award",
  metric: "ride_max_speed",
  comparison: "gte",
  threshold: 50,
  name: "Гонщик",
  description: "",
  imageId: null,
  enabled: true,
};
const record = {
  key: "rule_turtle",
  kind: "record",
  metric: "ride_avg_speed",
  direction: "min",
  minDistanceKm: 10,
  name: "Черепаха",
  enabled: true,
};
const invalid = (input) => !ruleInput.safeParse(input).success;
const message = (input) => ruleInput.safeParse(input).error.issues[0].message;

// #106: the administrator builds rules from the catalog only.
test("«Гонщик» and «Черепаха» are plain rules from catalog metrics", () => {
  assert.equal(ruleInput.parse(award).threshold, 50);
  const turtle = ruleInput.parse(record);
  assert.equal(turtle.threshold, null);
  assert.equal(turtle.minDistanceKm, 10);
  assert.deepEqual(turtle.keywords, []);
  assert.equal(invalid({ ...award, metric: "surprise" }), true);
  assert.equal(invalid({ ...award, sql: "SELECT 1" }), true);
});
test("every metric is usable as an award or a record, never as neither", () => {
  for (const metric of gameMetrics) {
    assert.ok(metric.award || metric.record, metric.key);
    assert.ok(metric.max > 0 && metric.step > 0, metric.key);
  }
});
test("a metric fits its kind: no award for a price, a weight or a year", () => {
  for (const metric of ["price", "weight", "year", "completeness"])
    assert.equal(
      message({ ...award, metric }),
      "Эта метрика не подходит для награды",
    );
  assert.equal(
    message({
      ...record,
      metric: "keywords",
      keywords: ["di2"],
      direction: "max",
    }),
    "Эта метрика не подходит для рекорда",
  );
});
test("an award needs a threshold within the metric, a record needs a direction", () => {
  assert.equal(message({ ...award, threshold: null }), "Укажите порог награды");
  assert.equal(
    message({ ...award, threshold: 301 }),
    "Порог больше допустимого для метрики",
  );
  assert.equal(invalid({ ...award, threshold: -1 }), true);
  assert.equal(
    message({ ...award, direction: "max" }),
    "У награды нет направления",
  );
  assert.equal(
    message({ ...record, direction: null }),
    "Выберите максимум или минимум",
  );
  assert.equal(message({ ...record, threshold: 5 }), "У рекорда нет порога");
  assert.equal(invalid({ ...award, comparison: "eq" }), true);
});
test("filters belong to their metrics", () => {
  assert.equal(ruleInput.parse({ ...record, category: "mtb" }).category, "mtb");
  assert.equal(invalid({ ...record, category: "unicycle" }), true);
  assert.equal(
    message({ ...award, metric: "followers", category: "mtb" }),
    "Фильтр по типу велосипеда не подходит для метрики",
  );
  assert.equal(
    message({ ...award, metric: "likes", minDistanceKm: 5 }),
    "Минимальная дистанция — только для покатушек",
  );
  assert.equal(
    message({ ...award, keywords: ["di2"] }),
    "Ключевые слова — только для метрики деталей",
  );
  assert.equal(
    message({ ...award, metric: "keywords", threshold: 1 }),
    "Укажите ключевые слова",
  );
});
test("keywords are words, not a regular expression", () => {
  const wireless = { ...award, metric: "keywords", threshold: 1 };
  assert.deepEqual(
    ruleInput.parse({
      ...wireless,
      keywords: [" Di2 ", "AXS", "e-Tap", "Шимано 105"],
    }).keywords,
    ["Di2", "AXS", "e-Tap", "Шимано 105"],
  );
  for (const word of [
    ".*",
    "a|b",
    "(x)",
    "\\m",
    "a]",
    "",
    " ",
    "-a",
    "x".repeat(31),
  ])
    assert.equal(invalid({ ...wireless, keywords: [word] }), true, word);
  assert.equal(invalid({ ...wireless, keywords: Array(11).fill("di2") }), true);
});
test("names, descriptions and illustrations stay short plain values", () => {
  assert.equal(message({ ...award, name: "  " }), "Укажите название");
  assert.equal(invalid({ ...award, name: "Я".repeat(61) }), true);
  assert.equal(
    ruleInput.parse({ ...award, description: "  Текст  " }).description,
    "Текст",
  );
  assert.equal(
    ruleInput.safeParse({
      ...award,
      description: "漢".repeat(gameDescriptionLimit),
    }).success,
    true,
  );
  assert.equal(
    invalid({ ...award, description: "漢".repeat(gameDescriptionLimit + 1) }),
    true,
  );
  // Markup is kept as text: React escapes it on every page.
  const markup = '<img src=x onerror="alert(1)">';
  assert.equal(
    ruleInput.parse({ ...award, description: markup }).description,
    markup,
  );
  assert.equal(ruleInput.parse({ ...award, imageId: id }).imageId, id);
  for (const imageId of [
    "javascript:alert(1)",
    "https://example.com/a.png",
    "1",
  ])
    assert.equal(invalid({ ...award, imageId }), true, imageId);
});
test("keys are permanent identifiers and never repeat in one list", () => {
  for (const key of ["Racer", "1racer", "r", "rule-racer", "x".repeat(41)])
    assert.equal(invalid({ ...award, key }), true, key);
  assert.equal(rulesInput.safeParse({ rules: [award, record] }).success, true);
  assert.equal(
    rulesInput.safeParse({ rules: [award, { ...record, key: award.key }] })
      .success,
    false,
  );
  assert.equal(
    rulesInput.safeParse({ rules: [award], extra: true }).success,
    false,
  );
  assert.equal(
    rulesInput.safeParse({ rules: Array(201).fill(award) }).success,
    false,
  );
});
test("rating settings keep only the global thresholds; old maps moved to the rules", () => {
  assert.equal(gameSettingsInput.safeParse(defaultGamification).success, true);
  for (const input of [
    { currency: "USD" },
    { weightMinimum: 60 },
    { budgetMinimum: 0 },
    { enabledRecords: ["budget"] },
    { recordImages: { budget: id } },
    { achievementDescriptions: { first_public: "Дебют" } },
  ])
    assert.equal(
      gameSettingsInput.safeParse({ ...defaultGamification, ...input }).success,
      false,
    );
  // Stored settings from before #106 still read.
  const stored = gameSettings({
    ...defaultGamification,
    budgetMinimum: 7000,
    enabledRecords: ["budget"],
    recordImages: { budget: id },
    recordDescriptions: { budget: "Цена" },
  });
  assert.equal(stored.budgetMinimum, 7000);
  assert.deepEqual(
    Object.keys(stored).sort(),
    Object.keys(defaultGamification).sort(),
  );
  assert.deepEqual(gameSettings(), { ...defaultGamification });
});
