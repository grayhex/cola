import test from "node:test";
import assert from "node:assert/strict";
import {
  groupedComponents,
  defaultGroups,
  specRows,
} from "../lib/garage-layout.js";
import { publicBike, safeLink } from "../lib/validation.js";
import { catalogInput, settingsInput } from "../lib/admin-validation.js";
import { defaultSettings, defaultCatalog } from "../lib/site-defaults.js";
test("groups honour explicit assignment and ordering including uncategorized parts", () => {
  const parts = [
    { id: "1", category: "Рама" },
    { id: "2", category: "Неизвестно" },
    { id: "3", category: "Рама", group_id: "brakes" },
  ];
  const groups = groupedComponents(parts, defaultGroups, [
    "other",
    "brakes",
    "frame",
  ]);
  assert.deepEqual(
    groups.map((g) => g.id),
    ["other", "brakes", "frame"],
  );
  assert.equal(groups[1].components[0].id, "3");
});
test("cost privacy applies separately and unsafe links are rejected", () => {
  const bike = {
    price: 100,
    components: [
      { section: "build", price: 20 },
      { section: "accessories", price: 30 },
    ],
    show_component_prices: true,
  };
  const visible = JSON.parse(JSON.stringify(publicBike(bike)));
  assert(!("price" in visible));
  assert.equal(visible.components[0].price, 20);
  assert(!("price" in visible.components[1]));
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "https://x:y@example.com",
  ])
    assert.equal(safeLink.safeParse(url).success, false);
  assert(safeLink.safeParse("https://cube.eu/").success);
});
test("layout validates group assignments and requires each block exactly once", () => {
  assert(catalogInput.safeParse(defaultCatalog).success);
  assert(settingsInput.safeParse(defaultSettings).success);
  assert.equal(
    catalogInput.safeParse({
      ...defaultCatalog,
      componentGroups: [...defaultGroups, defaultGroups[0]],
    }).success,
    false,
  );
  assert.equal(
    settingsInput.safeParse({
      ...defaultSettings,
      detailBlocks: Array(5).fill(defaultSettings.detailBlocks[0]),
    }).success,
    false,
  );
});
test("bike page summary: build parts in group order, one per category, no accessories", () => {
  const part = (category, name, section = "build") => ({
    category,
    name,
    section,
  });
  const rows = specRows([
    part("Кассета", "Shimano 11-34"),
    part("Рама", "Cube C:62"),
    part("Рама", "Second frame"),
    part("Велокомпьютер", "Garmin", "accessories"),
    part("Вилка", " "),
    part("Групсет", "GRX 820"),
  ]);
  assert.deepEqual(rows, [
    { category: "Рама", name: "Cube C:62" },
    { category: "Кассета", name: "Shimano 11-34" },
    { category: "Групсет", name: "GRX 820" },
  ]);
  assert.equal(
    specRows(
      Array.from({ length: 9 }, (_, i) => part("Деталь " + i, "Имя " + i)),
    ).length,
    6,
  );
});
