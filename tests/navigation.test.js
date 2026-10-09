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
    ["bikes", "components", "journal", "articles", "rides", "market", "about"],
  );
  assert.deepEqual(
    navigationSections({ navOrder: ["subscriptions", "home"] }).map(
      (s) => s.id,
    ),
    ["bikes", "components", "journal", "articles", "rides", "market", "about"],
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
