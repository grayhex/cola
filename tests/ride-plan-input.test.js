import test from "node:test";
import assert from "node:assert/strict";
import {
  foldChoices,
  foldOf,
  planInstants,
  planLocalTimes,
  planPrivacy,
} from "../lib/ride-plan-input.js";

// #253: Europe/Berlin goes back from 03:00 to 02:00 on 2031-10-26, so 02:30
// happens twice; on 2031-03-30 it jumps from 02:00 to 03:00.
const zone = "Europe/Berlin";

test("an end time not after the start is the next day", () => {
  assert.deepEqual(
    planLocalTimes({ date: "2031-12-31", time: "22:00", endTime: "01:00" }),
    { start: "2031-12-31T22:00", end: "2032-01-01T01:00" },
  );
  assert.deepEqual(
    planInstants({ date: "2031-06-01", time: "09:00", endTime: "12:00" }, zone),
    {
      scheduledAt: "2031-06-01T07:00:00.000Z",
      expectedEndAt: "2031-06-01T10:00:00.000Z",
    },
  );
  assert.equal(
    planInstants({ date: "2031-06-01", time: "09:00" }, zone).expectedEndAt,
    null,
  );
});

test("a repeated time asks which occurrence and honours the choice", () => {
  const form = { date: "2031-10-26", time: "02:30" };
  assert.equal(foldChoices("2031-10-26T02:30", zone).length, 2);
  assert.throws(() => planInstants(form, zone), /повторяется/);
  assert.equal(
    planInstants({ ...form, startFold: "earlier" }, zone).scheduledAt,
    "2031-10-26T00:30:00.000Z",
  );
  assert.equal(
    planInstants({ ...form, startFold: "later" }, zone).scheduledAt,
    "2031-10-26T01:30:00.000Z",
  );
  // Both second occurrences: the end stays on the same day.
  assert.deepEqual(
    planInstants(
      { ...form, endTime: "02:45", startFold: "later", endFold: "later" },
      zone,
    ),
    {
      scheduledAt: "2031-10-26T01:30:00.000Z",
      expectedEndAt: "2031-10-26T01:45:00.000Z",
    },
  );
  // Same wall-clock order, but the chosen occurrences put the end first.
  assert.throws(
    () =>
      planInstants(
        { ...form, endTime: "02:45", startFold: "later", endFold: "earlier" },
        zone,
      ),
    /позже старта/,
  );
  // Editing keeps the saved occurrence.
  assert.equal(foldOf("2031-10-26T01:30:00.000Z", zone), "later");
  assert.equal(foldOf("2031-10-26T00:30:00.000Z", zone), "earlier");
  assert.equal(foldOf("2031-06-01T07:00:00.000Z", zone), undefined);
});

test("a skipped time is rejected", () => {
  assert.throws(
    () => planInstants({ date: "2031-03-30", time: "02:30" }, zone),
    /не существует/,
  );
});

test("track protection follows the meeting point without a control", () => {
  assert.equal(planPrivacy(null, "participants"), true);
  assert.equal(planPrivacy(null, "public"), false);
  // Forced for a hidden point, lifted when the point becomes public.
  assert.equal(
    planPrivacy(
      { privacyEnabled: true, meetingVisibility: "participants" },
      "public",
    ),
    false,
  );
  // Chosen earlier with a public point: kept.
  assert.equal(
    planPrivacy(
      { privacyEnabled: true, meetingVisibility: "public" },
      "public",
    ),
    true,
  );
  assert.equal(
    planPrivacy(
      { privacyEnabled: false, meetingVisibility: "public" },
      "public",
    ),
    false,
  );
});
