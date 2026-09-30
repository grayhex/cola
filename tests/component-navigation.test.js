import test from "node:test";
import assert from "node:assert/strict";
import { defaultGroups } from "../lib/garage-layout.ts";
import {
  installationNavigation as componentNavigation,
  componentNavigation as productNavigation,
  componentCategoryPath,
  componentGroupPath,
} from "../lib/component-navigation.ts";

test("component navigation includes empty default categories without mutating the garage", () => {
  const before = structuredClone(defaultGroups);
  assert.deepEqual(componentNavigation(), defaultGroups);
  const groups = componentNavigation({}, [
    "Седло",
    "Custom type",
    "",
    "Custom type",
  ]);
  assert.deepEqual(groups.at(-1).categories, ["Custom type"]);
  assert.deepEqual(defaultGroups, before);
});

test("configured names and moved types coexist with unassigned defaults and custom categories", () => {
  const catalog = {
    componentGroups: [
      {
        id: "frame",
        name: "Рама и подвеска",
        icon: "frame",
        categories: ["Рама"],
      },
      {
        id: "custom",
        name: "Подвеска",
        icon: "fork",
        categories: ["Вилка", "Custom fork"],
      },
      {
        id: "other",
        name: "Дополнительно",
        icon: "other",
        categories: ["Custom fork", "Custom tool"],
      },
    ],
    partCategories: {
      build: ["Custom tool", "Custom build"],
      accessories: ["Custom accessory"],
    },
  };
  const groups = componentNavigation(catalog, ["Available only"]);
  assert.equal(groups[0].name, "Рама и подвеска");
  assert(groups[0].categories.includes("Амортизатор"));
  assert(!groups[0].categories.includes("Вилка"));
  assert.deepEqual(groups.find((g) => g.id === "custom").categories, [
    "Вилка",
    "Custom fork",
  ]);
  const all = groups.flatMap((g) => g.categories);
  assert.equal(all.length, new Set(all).size);
  for (const type of defaultGroups.flatMap((g) => g.categories))
    assert(all.includes(type), type);
  assert.deepEqual(groups.at(-1).categories, [
    "Custom tool",
    "Custom build",
    "Custom accessory",
    "Available only",
  ]);
});

test("public navigation contains only product classes and never positional or custom duplicates", () => {
  const before = structuredClone(defaultGroups);
  const groups = productNavigation(
    { partCategories: { build: ["Каретка", "Другое", "Custom"] } },
    ["Передняя покрышка"],
  );
  const categories = groups.flatMap((g) => g.categories);
  assert.equal(categories.length, new Set(categories).size);
  for (const category of [
    "Покрышки",
    "Обода",
    "Втулки",
    "Тормоза",
    "Манетки / дуалы",
    "Передний переключатель",
    "Задний переключатель",
  ])
    assert(categories.includes(category), category);
  for (const category of [
    "Каретка",
    "Кассета",
    "Роторы",
    "Тормозная ручка",
    "Подседельный зажим",
    "Камеры / бескамерка",
    "Другое",
    "Custom",
    "Передняя покрышка",
    "Левая манетка",
  ])
    assert(!categories.includes(category), category);
  assert.deepEqual(defaultGroups, before);
});

test("category and group addresses preserve names with URL punctuation", () => {
  const category = "Камеры / бескамерка & шины+#";
  assert.equal(
    new URL(
      componentCategoryPath(category),
      "https://example.test",
    ).searchParams.get("category"),
    category,
  );
  assert.equal(
    componentGroupPath("custom / #"),
    "/components#component-group-custom%20%2F%20%23",
  );
});
