import test from "node:test";
import assert from "node:assert/strict";
import { achievements, recordDefinitions } from "../lib/gamification-definitions.js";
import { defaultGameDescription, gameDescription, groupRecords, withGameDescriptions, gameDescriptionLimit } from "../lib/gamification-presentation.js";

test("every current record and achievement has a short default description", () => {
  for (const [kind, definitions] of [["record", recordDefinitions], ["achievement", achievements]]) {
    for (const d of definitions) {
      const text = defaultGameDescription(kind, d.key);
      assert.ok(text.length > 0 && text.length <= gameDescriptionLimit, d.key);
    }
  }
});
test("logical groups contain each record exactly once; no empty groups or lost future records", () => {
  const groups = groupRecords(recordDefinitions);
  assert.deepEqual(groups.map(g => g.id), ["price", "weight", "build", "community"]);
  assert.deepEqual(groups.map(g => g.records.length), [2, 3, 2, 5]);
  assert.deepEqual(groups.flatMap(g => g.records.map(r => r.key)).sort(), recordDefinitions.map(r => r.key).sort());
  assert.deepEqual(groupRecords([]), []);
  assert.equal(groupRecords([recordDefinitions[0]]).length, 1);
  const unknown = {key: "future", group: "Future"};
  assert.deepEqual(groupRecords([unknown])[0].records, [unknown]);
});
test("custom descriptions override defaults; empty reset restores the default", () => {
  const item = {key: "budget"};
  assert.equal(gameDescription("record", item, {recordDescriptions:{budget:"  Самый дешёвый байк сайта.  "}}), "Самый дешёвый байк сайта.");
  assert.equal(gameDescription("record", item, {recordDescriptions:{budget:" "}}), defaultGameDescription("record", "budget"));
  assert.equal(gameDescription("achievement", {key:"first_public"}, {achievementDescriptions:{first_public:"Дебют на витрине."}}), "Дебют на витрине.");
});
test("presentation changes do not fabricate holders or unlock private awards", () => {
  const holder = {id:"bike", value:8.2};
  const data = {records:[{key:"budget",holder:null},{key:"lightest_gravel",holder}],awards:[],locked:[{key:"full_build",progress:null,imageId:"image"}]};
  const settings = {recordDescriptions:{budget:"Свободно",expensive:"Invisible"},achievementDescriptions:{full_build:"Подготовить сборку"}};
  const result = withGameDescriptions(data, settings);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].holder, null);
  assert.equal(result.records[1].holder, holder);
  assert.deepEqual(result.awards, []);
  assert.equal(result.locked[0].progress, null);
  assert.equal(result.locked[0].imageId, "image");
  assert.equal(data.records[0].description, undefined);
  assert.deepEqual(withGameDescriptions({asOf:"today"}), {asOf:"today"});
});
test("descriptions remain plain text, not executable markup", () => {
  const text = '<img src=x onerror="alert(1)">';
  assert.equal(gameDescription("record", {key:"budget"}, {recordDescriptions:{budget:text}}), text);
});
