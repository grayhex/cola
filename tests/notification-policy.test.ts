import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalTimeZone,
  defaultDeliveryPolicy,
  externalVerdict,
  formatClock,
  nearCancellationMs,
  parseClock,
  quietEnd,
  wallClockToInstant,
  type DeliveryPolicy,
} from "../lib/notification-policy.ts";

// The clock of the person decides, not the server's: a window "22:00–07:00" is
// read in their zone, follows daylight saving time and never sends in the
// morning what has expired in the night (#341).

const at = (iso: string) => new Date(iso);
const policy = (
  timeZone: string,
  quiet: Partial<DeliveryPolicy["quiet"]> = {},
  pausedUntil: Date | null = null,
): DeliveryPolicy => ({
  timeZone,
  quiet: { ...defaultDeliveryPolicy.quiet, enabled: true, ...quiet },
  pausedUntil,
});

test("time zones are IANA names, not offsets", () => {
  assert.equal(canonicalTimeZone("Europe/Moscow"), "Europe/Moscow");
  // Names are the ICU's canonical ones, which may differ between versions.
  assert.ok(canonicalTimeZone("America/Argentina/Buenos_Aires"));
  assert.equal(canonicalTimeZone("UTC"), "UTC");
  for (const wrong of [
    "+03:00",
    "GMT+3",
    "Mars/Base",
    "",
    "Europe/",
    " Europe/Moscow",
    "../etc",
  ])
    assert.equal(canonicalTimeZone(wrong), null, wrong);
});

test("a time of day is HH:MM and nothing else", () => {
  assert.equal(parseClock("00:00"), 0);
  assert.equal(parseClock("22:30"), 1350);
  assert.equal(parseClock("23:59"), 1439);
  for (const wrong of ["24:00", "7:00", "07:60", "07:00:00", "", "ab:cd"])
    assert.equal(parseClock(wrong), null, wrong);
  assert.equal(formatClock(1350), "22:30");
  assert.equal(formatClock(420), "07:00");
});

test("the quiet window ends on the person's own clock", () => {
  const moscow = policy("Europe/Moscow"); // UTC+3 all year, 22:00–07:00
  // 23:00 local: the window ends at 07:00 the next morning, which is 04:00Z.
  assert.equal(
    quietEnd(moscow, at("2026-10-04T20:00:00Z"))?.toISOString(),
    "2026-10-05T04:00:00.000Z",
  );
  // 05:00 local, after midnight: the same morning.
  assert.equal(
    quietEnd(moscow, at("2026-10-05T02:00:00Z"))?.toISOString(),
    "2026-10-05T04:00:00.000Z",
  );
  // The edges: 22:00 is inside, 07:00 is outside.
  assert.ok(quietEnd(moscow, at("2026-10-04T19:00:00Z")));
  assert.equal(quietEnd(moscow, at("2026-10-05T04:00:00Z")), null);
  assert.equal(quietEnd(moscow, at("2026-10-04T09:00:00Z")), null);
});

test("the same instant is quiet in one zone and not in another", () => {
  const instant = at("2026-10-04T20:00:00Z");
  assert.ok(quietEnd(policy("Europe/Moscow"), instant)); // 23:00
  assert.equal(quietEnd(policy("America/New_York"), instant), null); // 16:00
  assert.ok(quietEnd(policy("Asia/Vladivostok"), instant)); // 06:00 next day
});

test("a window inside one day does not wrap", () => {
  const lunch = policy("Europe/Moscow", { from: 13 * 60, to: 15 * 60 });
  assert.equal(
    quietEnd(lunch, at("2026-10-04T10:30:00Z"))?.toISOString(),
    "2026-10-04T12:00:00.000Z",
  );
  assert.equal(quietEnd(lunch, at("2026-10-04T12:00:00Z")), null);
  assert.equal(quietEnd(lunch, at("2026-10-04T09:59:00Z")), null);
});

test("switched off, without a zone, or empty: no quiet", () => {
  const instant = at("2026-10-04T20:00:00Z");
  assert.equal(
    quietEnd(policy("Europe/Moscow", { enabled: false }), instant),
    null,
  );
  assert.equal(
    quietEnd({ ...policy("Europe/Moscow"), timeZone: null }, instant),
    null,
  );
  assert.equal(
    quietEnd(policy("Europe/Moscow", { from: 60, to: 60 }), instant),
    null,
  );
  assert.equal(quietEnd(defaultDeliveryPolicy, instant), null);
});

test("daylight saving time moves the end, not the wall clock", () => {
  const berlin = policy("Europe/Berlin");
  // 2026-03-29: 02:00 became 03:00. The night of the 28th is one hour shorter,
  // and 07:00 on the 29th is CEST (UTC+2): 05:00Z.
  assert.equal(
    quietEnd(berlin, at("2026-03-28T22:30:00Z"))?.toISOString(),
    "2026-03-29T05:00:00.000Z",
  );
  assert.equal(
    quietEnd(berlin, at("2026-03-29T00:30:00Z"))?.toISOString(),
    "2026-03-29T05:00:00.000Z",
  );
  // 2026-10-25: 03:00 became 02:00. 07:00 on the 25th is CET (UTC+1): 06:00Z.
  assert.equal(
    quietEnd(berlin, at("2026-10-24T22:30:00Z"))?.toISOString(),
    "2026-10-25T06:00:00.000Z",
  );
  assert.equal(
    quietEnd(berlin, at("2026-10-25T01:30:00Z"))?.toISOString(),
    "2026-10-25T06:00:00.000Z",
  );
  // A day after the change the offset is the new one.
  assert.equal(
    quietEnd(berlin, at("2026-10-25T21:30:00Z"))?.toISOString(),
    "2026-10-26T06:00:00.000Z",
  );
});

test("a wall time that does not exist is the first moment after the gap, a repeated one the first time", () => {
  // Berlin skips 02:00–03:00 on 2026-03-29: 02:30 does not exist, and a clock
  // that skipped the hour shows it as 03:30 CEST (01:30Z).
  assert.equal(
    wallClockToInstant(
      { year: 2026, month: 3, day: 29 },
      150,
      "Europe/Berlin",
    ).toISOString(),
    "2026-03-29T01:30:00.000Z",
  );
  // Berlin repeats 02:00–03:00 on 2026-10-25: 02:30 CEST (00:30Z) is the first.
  assert.equal(
    wallClockToInstant(
      { year: 2026, month: 10, day: 25 },
      150,
      "Europe/Berlin",
    ).toISOString(),
    "2026-10-25T00:30:00.000Z",
  );
  // An ordinary day.
  assert.equal(
    wallClockToInstant(
      { year: 2026, month: 7, day: 1 },
      420,
      "Europe/Moscow",
    ).toISOString(),
    "2026-07-01T04:00:00.000Z",
  );
  assert.equal(
    wallClockToInstant(
      { year: 2026, month: 7, day: 1 },
      420,
      "America/New_York",
    ).toISOString(),
    "2026-07-01T11:00:00.000Z",
  );
});

test("outside the quiet a message goes at once", () => {
  assert.deepEqual(
    externalVerdict(policy("Europe/Moscow"), {
      type: "comment",
      now: at("2026-10-04T09:00:00Z"),
    }),
    { action: "deliver" },
  );
  assert.deepEqual(
    externalVerdict(defaultDeliveryPolicy, {
      type: "comment",
      now: at("2026-10-04T23:00:00Z"),
    }),
    { action: "deliver" },
  );
});

test("inside the quiet it waits for the end", () => {
  const verdict = externalVerdict(policy("Europe/Moscow"), {
    type: "ride_changed",
    now: at("2026-10-04T20:00:00Z"),
    expiresAt: at("2026-10-11T20:00:00Z"),
  });
  assert.equal(verdict.action, "defer");
  assert.equal(
    verdict.action === "defer" && verdict.until.toISOString(),
    "2026-10-05T04:00:00.000Z",
  );
});

test("what expires before the morning is dropped, never sent in the morning", () => {
  const night = at("2026-10-04T20:00:00Z");
  // Expires at 23:00Z, five hours before the quiet ends (04:00Z).
  assert.deepEqual(
    externalVerdict(policy("Europe/Moscow"), {
      type: "ride_reminder",
      now: night,
      expiresAt: at("2026-10-04T23:00:00Z"),
    }),
    { action: "drop", reason: "quiet" },
  );
  // Expires exactly when the quiet ends: already worthless.
  assert.deepEqual(
    externalVerdict(policy("Europe/Moscow"), {
      type: "ride_reminder",
      now: night,
      expiresAt: at("2026-10-05T04:00:00Z"),
    }),
    { action: "drop", reason: "quiet" },
  );
  // Already expired, quiet or not.
  assert.deepEqual(
    externalVerdict(defaultDeliveryPolicy, {
      type: "ride_reminder",
      now: night,
      expiresAt: night,
    }),
    { action: "drop", reason: "expired" },
  );
});

test("a pause drops what falls in it and wins over the quiet", () => {
  const paused = policy("Europe/Moscow", {}, at("2026-10-07T00:00:00Z"));
  assert.deepEqual(
    externalVerdict(paused, {
      type: "comment",
      now: at("2026-10-04T09:00:00Z"),
    }),
    { action: "drop", reason: "paused" },
  );
  assert.deepEqual(
    externalVerdict(paused, {
      type: "comment",
      now: at("2026-10-04T20:00:00Z"),
    }),
    { action: "drop", reason: "paused" },
  );
  // After it ends the pause is nothing.
  assert.deepEqual(
    externalVerdict(paused, {
      type: "comment",
      now: at("2026-10-07T09:00:00Z"),
    }),
    { action: "deliver" },
  );
});

test("a close cancellation of a ride the person confirmed breaks the quiet only if they chose so", () => {
  const night = at("2026-10-04T20:00:00Z");
  const soon = new Date(night.getTime() + 3 * 3600_000);
  const cancelled = {
    type: "ride_cancelled",
    now: night,
    occursAt: soon,
    confirmed: true,
  };
  const chosen = policy("Europe/Moscow", { allowCancellations: true });
  assert.deepEqual(externalVerdict(chosen, cancelled), { action: "deliver" });
  // The default: not allowed.
  assert.equal(
    externalVerdict(policy("Europe/Moscow"), cancelled).action,
    "defer",
  );
  // Not confirmed, not near, already past, another kind of message: held back.
  assert.equal(
    externalVerdict(chosen, { ...cancelled, confirmed: false }).action,
    "defer",
  );
  assert.equal(
    externalVerdict(chosen, {
      ...cancelled,
      occursAt: new Date(night.getTime() + nearCancellationMs + 1),
    }).action,
    "defer",
  );
  assert.equal(
    externalVerdict(chosen, { ...cancelled, occursAt: night }).action,
    "defer",
  );
  assert.equal(
    externalVerdict(chosen, { ...cancelled, type: "ride_changed" }).action,
    "defer",
  );
  // The pause is not the quiet: the exception does not cross it.
  assert.deepEqual(
    externalVerdict(
      policy(
        "Europe/Moscow",
        { allowCancellations: true },
        at("2026-10-06T00:00:00Z"),
      ),
      cancelled,
    ),
    { action: "drop", reason: "paused" },
  );
});
