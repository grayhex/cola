import test from "node:test";
import assert from "node:assert/strict";
import { defaultGamification, recordDefinitions, achievements } from "../lib/gamification-definitions.js";
import { gameSettings, gameSettingsInput } from "../lib/gamification-validation.js";
import { gameDescriptionLimit } from "../lib/gamification-presentation.js";

test("description maps validate all known slots, text types and length", () => {
  const value = {...defaultGamification, recordDescriptions:Object.fromEntries(recordDefinitions.map(r=>[r.key,"Рекорд"])),achievementDescriptions:Object.fromEntries(achievements.map(a=>[a.key,"Награда"]))};
  assert.equal(gameSettingsInput.safeParse(value).success,true);
  for (const recordDescriptions of [{unknown:"Текст"},{budget:42},{budget:null},{budget:"я".repeat(gameDescriptionLimit+1)}]) {
    assert.equal(gameSettingsInput.safeParse({...value,recordDescriptions}).success,false);
  }
  assert.equal(gameSettingsInput.safeParse({...value,achievementDescriptions:{budget:"Чужой ключ"}}).success,false);
  assert.equal(gameSettingsInput.parse({...value,recordDescriptions:{budget:"  Текст  "}}).recordDescriptions.budget,"Текст");
});
test("legacy request omission preserves stored descriptions and artwork; explicit reset works", () => {
  assert.deepEqual(gameSettings().recordDescriptions,{});
  const existing = gameSettings({recordDescriptions:{budget:"Цена"},achievementDescriptions:{first_public:"Дебют"}});
  const legacy = gameSettingsInput.parse(defaultGamification);
  assert.equal(Object.hasOwn(legacy,"recordDescriptions"),false);
  assert.equal(gameSettings({...existing,...legacy}).recordDescriptions.budget,"Цена");
  assert.deepEqual(gameSettings({...existing,recordDescriptions:{}}).recordDescriptions,{});
  assert.equal(gameSettings({...existing,recordDescriptions:{budget:""}}).recordDescriptions.budget,"");
});
