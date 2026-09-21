import test from "node:test";
import assert from "node:assert/strict";
import { parseGpx } from "../lib/ride-gpx.js";
import { speedProfile } from "../lib/ride-speed.js";
import { gpx, loop } from "./ride-fixtures.js";

test("speed uses measured visible GPX intervals, has bounded size and exposes no coordinates or timestamps", () => {
  const parsed = parseGpx(gpx([loop]));
  const full = speedProfile(parsed.samples, false, 500);
  const privateProfile = speedProfile(parsed.samples, true, 500);
  assert.ok(full.flat().length > privateProfile.flat().length);
  assert.ok(privateProfile.flat().length > 0);
  assert.ok(
    privateProfile.flat().at(-1).distanceKm < full.flat().at(-1).distanceKm,
  );
  for (const point of privateProfile.flat()) {
    assert.deepEqual(Object.keys(point), ["distanceKm", "speedKmh"]);
    assert.ok(point.speedKmh > 0 && point.speedKmh < 162);
  }
  assert.ok(speedProfile(parsed.samples, false, 500, 12).flat().length <= 12);
});
test("missing times, invalid intervals, separate tracks and fully hidden rides do not invent a continuous curve", () => {
  assert.deepEqual(
    speedProfile(parseGpx(gpx([loop], { time: false })).samples, false, 500),
    [],
  );
  assert.deepEqual(
    speedProfile(parseGpx(gpx([loop])).samples, true, 100000),
    [],
  );
  const samples = [
    [
      { coord: [0, 0], time: 0 },
      { coord: [0.001, 0], time: 20 },
      { coord: [0.002, 0], time: 2000 },
      { coord: [0.003, 0], time: 2020 },
    ],
    [
      { coord: [1, 1], time: 2040 },
      { coord: [1.001, 1], time: 2060 },
    ],
  ];
  const profile = speedProfile(samples, false, 500);
  assert.equal(profile.length, 3);
  assert.ok(profile.flat().at(-1).distanceKm < 1, "no bridge between tracks");
});
