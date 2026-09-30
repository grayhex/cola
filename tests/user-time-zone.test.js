import test from "node:test";
import assert from "node:assert/strict";
import { preferencesInput } from "../lib/social-validation.ts";
import { timeZoneChoices, userTimeZone } from "../lib/user-time-zone.ts";

// #253: the profile keeps the rider's IANA zone among private preferences.
test("profile time zone accepts IANA zones and rejects anything else", () => {
  assert.equal(
    preferencesInput.parse({ preferences: { timeZone: "Asia/Vladivostok" } })
      .preferences.timeZone,
    "Asia/Vladivostok",
  );
  assert.deepEqual(preferencesInput.parse({ preferences: {} }).preferences, {});
  for (const timeZone of ["Mars/Base", "+03:00", "", "x".repeat(101)])
    assert.equal(
      preferencesInput.safeParse({ preferences: { timeZone } }).success,
      false,
      timeZone,
    );
});

test("new plans use the profile zone, else the browser's", () => {
  assert.equal(userTimeZone({ timeZone: "Europe/Moscow" }), "Europe/Moscow");
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(userTimeZone({ timeZone: "Nowhere/Land" }), browser);
  assert.equal(userTimeZone(null), browser);
  assert.ok(timeZoneChoices().includes("Europe/Moscow"));
});
