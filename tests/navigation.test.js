import test from "node:test";
import assert from "node:assert/strict";
import {
  navigationSections,
  sectionLinks,
  activeSection,
  sectionDefaults,
} from "../lib/navigation.ts";
import { settingsInput } from "../lib/admin-validation.ts";
import { defaultSettings } from "../lib/site-defaults.ts";
test("navigation defaults ignore retired ordering fields; known destinations respect auth", () => {
  assert.deepEqual(
    navigationSections({}).map((s) => s.id),
    [
      "bikes",
      "components",
      "journal",
      "articles",
      "rides",
      "achievements",
      "market",
      "about",
    ],
  );
  assert.deepEqual(
    navigationSections({ navOrder: ["subscriptions", "home"] }).map(
      (s) => s.id,
    ),
    [
      "bikes",
      "components",
      "journal",
      "articles",
      "rides",
      "achievements",
      "market",
      "about",
    ],
  );
  assert.equal(
    sectionLinks("bikes", null).some((s) => s.href.includes("action=add")),
    false,
  );
  assert.equal(
    sectionLinks("bikes", { id: "owner" }).at(-1).href,
    "/account?tab=bikes&action=add",
  );
  for (const user of [null, { id: "owner" }]) {
    const links = sectionLinks("rides", user);
    // A guest's link asks for registration first (#378).
    assert(
      links.some((link) => /action=plan(&auth=register)?$/.test(link.href)),
    );
    assert(links.every((link) => !/action=(?:add|import)/.test(link.href)));
  }
  // #382: «Достижения» is a section of its own with the two tabs of /records,
  // and «Рекорды» left «Велосипеды».
  assert.deepEqual(
    sectionLinks("achievements", null).map((l) => [l.href, l.label]),
    [
      ["/records", "Рекорды"],
      ["/records?tab=awards", "Награды"],
    ],
  );
  for (const user of [null, { id: "owner" }])
    assert.equal(
      sectionLinks("bikes", user).some((l) => l.href.startsWith("/records")),
      false,
    );
  assert.equal(activeSection("/records"), "achievements");
  assert.equal(activeSection("/records", "?tab=awards"), "achievements");
  assert.equal(activeSection("/account", "?tab=rides"), "rides");
  assert.equal(activeSection("/r/share"), "rides");
  assert.equal(activeSection("/about"), "about");
  assert.equal(activeSection("/notifications"), null);
});
test("a list saved before «Достижения» gets it once, after «Покатушки»; a saved one is left as the administrator made it (#382)", () => {
  const old = sectionDefaults
    .filter((s) => s.id !== "achievements")
    .map((s) => (s.id === "journal" ? { ...s, visible: false } : s))
    .reverse();
  const migrated = navigationSections({ navigation: old });
  assert.equal(migrated.length, old.length + 1);
  // The other sections keep their order and visibility; the new one follows
  // «Покатушки», wherever the administrator put it.
  assert.deepEqual(
    migrated.filter((s) => s.id !== "achievements"),
    old,
  );
  assert.equal(
    migrated.findIndex((s) => s.id === "achievements"),
    migrated.findIndex((s) => s.id === "rides") + 1,
  );
  assert.equal(migrated.find((s) => s.id === "achievements").visible, true);
  // Hidden by the administrator it stays hidden and where it is.
  const hidden = [
    ...old.slice(0, 2),
    { id: "achievements", label: "Хроника", visible: false },
    ...old.slice(2),
  ];
  assert.deepEqual(navigationSections({ navigation: hidden }), hidden);
});
test("admin schema accepts missing legacy configuration but rejects unknown destinations and duplicate IDs", () => {
  const legacy = { ...defaultSettings };
  delete legacy.about;
  assert.equal(settingsInput.parse(legacy).about.sections.length, 2);
  const value = { ...defaultSettings, navigation: sectionDefaults };
  assert.equal(settingsInput.safeParse(value).success, true);
  for (const navigation of [
    [...sectionDefaults, sectionDefaults[0]],
    sectionDefaults.map((s) => ({ ...s, id: "bikes" })),
    [...sectionDefaults, { ...sectionDefaults[0], id: "extra" }],
    sectionDefaults.map((s) => ({ ...s, url: "https://example.test" })),
    [{ ...sectionDefaults[0], id: "external" }, ...sectionDefaults.slice(1)],
  ])
    assert.equal(
      settingsInput.safeParse({ ...value, navigation }).success,
      false,
    );
  assert.equal(
    settingsInput.safeParse({
      ...value,
      about: { ...value.about, hiddenItems: ["invented"] },
    }).success,
    false,
  );
});
