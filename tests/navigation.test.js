import test from "node:test";
import assert from "node:assert/strict";
import {
  navigationSections,
  sectionLinks,
  activeSection,
  sectionDefaults,
} from "../lib/navigation.js";
import { settingsInput } from "../lib/admin-validation.js";
import { defaultSettings } from "../lib/site-defaults.js";
test("legacy navigation settings retain ordering intent; known destinations respect auth", () => {
  assert.deepEqual(
    navigationSections({}).map((s) => s.id),
    ["bikes", "rides", "about"],
  );
  assert.deepEqual(
    navigationSections({ navOrder: ["subscriptions", "home"] }).map(
      (s) => s.id,
    ),
    ["rides", "bikes", "about"],
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
