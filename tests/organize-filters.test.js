import test from "node:test";
import assert from "node:assert/strict";
import {
  readOrganize,
  organizeQuery,
  organizeDraft,
} from "../lib/organize-filters.ts";
import { groupsQuery, queryObject } from "../lib/ride-match-input.ts";

// #234: the organizer's filters reach the URL and the API only as shared
// choices, and the planner prefill carries the group's start and format only.
test("organizer filters keep known values and default to a week of short rides", () => {
  assert.deepEqual(readOrganize(new URLSearchParams()), {
    when: "week",
    duration: "short",
  });
  assert.deepEqual(
    readOrganize(
      new URLSearchParams(
        "when=weekend&duration=long&purpose=social&pace=nope&area=%20Парк%20&user=x",
      ),
    ),
    { when: "weekend", duration: "long", purpose: "social", area: "Парк" },
  );
});

test("the groups query is valid for the API contract", () => {
  const now = new Date("2031-03-05T10:00:00Z");
  const params = organizeQuery(
    { when: "week", duration: "medium", purpose: "social", area: "Парк" },
    now,
  );
  const parsed = groupsQuery.parse(queryObject(params));
  assert.equal(parsed.durationMin, 120);
  assert.equal(parsed.durationMax, 240);
  assert.equal(parsed.purpose, "social");
  assert.equal(parsed.areaText, "Парк");
  assert.equal(parsed.from, now.toISOString());
});

test("a window in progress is proposed from the next whole minute", () => {
  assert.equal(
    organizeDraft(
      { duration: "short" },
      { startFrom: "2031-03-08T06:00:12.345Z" },
    ).startAt,
    "2031-03-08T06:01:00.000Z",
  );
});

test("the planner prefill is the group's start and format, nothing personal", () => {
  const draft = organizeDraft(
    { duration: "short", pace: "relaxed", area: "Сокольники" },
    {
      startFrom: "2031-03-08T06:00:00.000Z",
      startUntil: "2031-03-08T08:00:00.000Z",
      counts: { total: 3 },
    },
  );
  assert.deepEqual(draft, {
    startAt: "2031-03-08T06:00:00.000Z",
    passport: {
      durationMinutes: { min: 60, max: 120 },
      pace: "relaxed",
      area: { label: "Сокольники" },
    },
    fromInterest: true,
  });
});
