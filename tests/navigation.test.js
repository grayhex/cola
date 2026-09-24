import test from "node:test";
import assert from "node:assert/strict";
import {
  navigationSections,
  sectionLinks,
  activeSection,
  sectionDefaults,
  mobileTabs,
} from "../lib/navigation.js";
import { settingsInput } from "../lib/admin-validation.js";
import { defaultSettings } from "../lib/site-defaults.js";
test("navigation defaults ignore retired ordering fields; known destinations respect auth", () => {
  assert.deepEqual(
    navigationSections({}).map((s) => s.id),
    ["bikes", "journal", "articles", "rides", "market", "about"],
  );
  assert.deepEqual(
    navigationSections({ navOrder: ["subscriptions", "home"] }).map(
      (s) => s.id,
    ),
    ["bikes", "journal", "articles", "rides", "market", "about"],
  );
  assert.equal(
    sectionLinks("bikes", null).some((s) => s.href.includes("action=add")),
    false,
  );
  assert.equal(
    sectionLinks("bikes", { id: "owner" }).at(-1).href,
    "/account?tab=bikes&action=add",
  );
  assert.equal(activeSection("/account", "?tab=rides"), "rides");
  assert.equal(activeSection("/r/share"), "rides");
  assert.equal(activeSection("/about"), "about");
  assert.equal(activeSection("/notifications"), null);
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
test("mobile tabs: four fixed sections the admin keeps visible, then the profile", () => {
  const hrefs = (sections, user) =>
    mobileTabs(sections, user).map((t) => t.label + " " + t.href);
  assert.deepEqual(hrefs(sectionDefaults, null), [
    "Велосипеды /bikes",
    "Покатушки /rides",
    "Журнал /journal",
    "Рынок /market",
    "Профиль /account",
  ]);
  // Admin order and labels stay in the menu; the bar keeps its short names.
  const custom = [...sectionDefaults]
    .reverse()
    .map((s) => ({ ...s, label: s.label + " сообщества" }))
    .map((s) => (s.id === "market" ? { ...s, visible: false } : s));
  assert.deepEqual(hrefs(custom, { username: "Rider_1" }), [
    "Велосипеды /bikes",
    "Покатушки /rides",
    "Журнал /journal",
    "Профиль /@rider_1",
  ]);
  assert.equal(
    mobileTabs(sectionDefaults, { id: "u" }).at(-1).href,
    "/account?tab=profile",
  );
});
