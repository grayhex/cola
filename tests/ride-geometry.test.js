import test from "node:test";
import assert from "node:assert/strict";
import { parseGpx } from "../lib/ride-gpx.js";
import {
  distance,
  publicGeometry,
  bounds,
  routePaths,
} from "../lib/ride-geometry.js";
import { gpx, loop } from "./ride-fixtures.js";
test("GPX metrics: known distance, moving average excludes stops and segments", () => {
  const p = parseGpx(
    gpx([
      [
        [0, 0, 0],
        [0.001, 0, 30],
        [0.001, 0, 300],
        [0.002, 0, 330],
      ],
      [
        [1, 0, 400],
        [1.001, 0, 430],
      ],
    ]),
  );
  assert.ok(Math.abs(p.metrics.distanceM - 334) < 2);
  assert.equal(p.metrics.elapsedTimeS, 430);
  assert.equal(p.metrics.movingTimeS, 90);
  assert.ok(Math.abs(p.metrics.avgSpeedMps - 3.706) < 0.01);
  assert.equal(p.geometry.length, 2);
  const none = parseGpx(gpx([loop], { time: false, elevation: false }));
  assert.equal(none.metrics.movingTimeS, null);
  assert.equal(none.metrics.avgSpeedMps, null);
  assert.equal(none.metrics.elevationGainM, null);
  assert.equal(none.metrics.elapsedTimeS, null);
});
test("XML validation, entities, coordinates, nesting, point/body limits and route fallback", () => {
  for (const s of [
    "",
    "<xml/>",
    "<gpx><trk></gpx>",
    '<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]><gpx/>',
    '<gpx><rte><rtept lat="91" lon="0"/></rte></gpx>',
  ])
    assert.throws(() => parseGpx(Buffer.from(s)));
  assert.throws(() => parseGpx(gpx([loop]), { maxPoints: 3 }));
  assert.throws(() => parseGpx(gpx([loop]), { maxBytes: 10 }));
  const route = Buffer.from(
    '<gpx><rte><rtept lat="0" lon="0"/><rtept lat="0" lon="0.01"/></rte></gpx>',
  );
  assert.equal(parseGpx(route).geometry.length, 1);
});
test("GPS discontinuity preserves a two-point leg for timed and untimed tracks", () => {
  const legs = [
    [
      [0, 0, 0],
      [0.001, 0, 30],
      [1, 0, 60],
      [1.001, 0, 90],
    ],
  ];
  for (const time of [true, false]) {
    const parsed = parseGpx(gpx(legs, { time }));
    assert.deepEqual(parsed.geometry, [
      [
        [0, 0],
        [0.001, 0],
      ],
      [
        [1, 0],
        [1.001, 0],
      ],
    ]);
    assert.ok(Math.abs(parsed.metrics.distanceM - 222) < 2);
    assert.equal(parsed.metrics.movingTimeS, time ? 60 : null);
  }
});
test("duplicates, backwards timestamps, GPS spikes and elevation noise are safe", () => {
  const p = parseGpx(
    gpx([
      [
        [0, 0, 0, 100],
        [0.001, 0, 30, 100.1],
        [30, 30, 31, 500],
        [0.002, 0, 60, 99.9],
        [0.003, 0, 90, 100],
        [0.004, 0, 80, 100],
      ],
    ]),
  );
  assert.ok(p.metrics.distanceM < 500);
  assert.ok(p.metrics.elevationGainM < 3);
  assert.equal(p.geometry.length, 2);
});
test("privacy removes all visits to overlapping start/end zones without bridges", () => {
  const original = [...loop, ...loop.slice(1)];
  const output = publicGeometry([original], true, 500);
  assert.ok(output.length >= 2);
  for (const s of output)
    for (const p of s) assert.ok(distance(p, original[0]) >= 500);
  assert.notDeepEqual(output[0][0], original[0]);
  assert.notDeepEqual(bounds(output), bounds([original]));
  assert.equal(routePaths(output).length, output.length);
  assert.equal(publicGeometry([loop], false).length, 1);
  assert.deepEqual(
    publicGeometry(
      [
        [
          [0, 0],
          [0.0001, 0],
        ],
      ],
      true,
      500,
    ),
    [],
  );
});
test("sparse line crossing privacy zone and simplification cannot reveal hidden zone", () => {
  const segments = [
    [
      [0, 0],
      [0.02, 0],
      [0.02, 0.02],
    ],
    [
      [-0.02, 0],
      [0.02, 0],
    ],
    [
      [0.03, 0.02],
      [0.04, 0.02],
    ],
  ];
  const visible = publicGeometry(segments, true, 500);
  assert.ok(
    !visible.some((s) =>
      s.some((p, i) => i && s[i - 1][0] < 0 && p[0] > 0 && p[1] === 0),
    ),
  );
});
