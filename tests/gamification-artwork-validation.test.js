import test from "node:test";
import assert from "node:assert/strict";
import { gameSettingsInput, gameSettings } from "../lib/gamification-validation.js";
import { achievements, recordDefinitions, defaultGamification } from "../lib/gamification-definitions.js";
const id = "00000000-0000-4000-8000-000000000001";
test("every defined record and achievement has an independently assignable image slot", () => {
  const settings = gameSettings({
    ...defaultGamification,
    recordImages: Object.fromEntries(recordDefinitions.map((r) => [r.key, id])),
    achievementImages: Object.fromEntries(achievements.map((a) => [a.key, id])),
  });
  assert.equal(Object.keys(settings.recordImages).length, 12);
  assert.equal(Object.keys(settings.achievementImages).length, 10);
});
test("illustration schema rejects external URLs, malformed IDs and unknown keys", () => {
  for (const recordImages of [{ budget: "javascript:alert(1)" }, { budget: "https://example.com/a.png" }, { nope: id }, { first_public: id }])
    assert.equal(gameSettingsInput.safeParse({ ...defaultGamification, recordImages }).success, false);
  assert.equal(gameSettingsInput.safeParse({ ...defaultGamification, achievementImages: { expensive: id } }).success, false);
});
test("legacy settings get empty maps while legacy PUT omissions remain omitted", () => {
  assert.deepEqual(gameSettings(defaultGamification).recordImages, {});
  assert.deepEqual(gameSettings(defaultGamification).achievementImages, {});
  assert.equal(Object.hasOwn(gameSettingsInput.parse(defaultGamification), "recordImages"), false);
  assert.equal(gameSettings({ recordImages: { budget: null } }).recordImages.budget, null);
});
