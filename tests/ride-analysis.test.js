import test from "node:test";
import assert from "node:assert/strict";
import { parseTrack } from "../lib/ride-track.js";
import {
  deriveAnalysis,
  permittedAnalysis,
  ANALYSIS_LIMIT,
  analysisChannels,
} from "../lib/ride-analysis.js";
import { distance, lineDistance } from "../lib/ride-geometry.js";
import { gpx, fit, tcx, loop } from "./ride-fixtures.js";
const flat = (s) => s.segments.flat();

test("GPX extension URIs, aliases and local namespaces supply sensors; unknown extensions never masquerade as known ones", () => {
  const point = (i, ext) =>
    `<trkpt lat="55.7" lon="${37.5 + i * 0.001}"><time>2026-09-16T00:00:${String(i * 10).padStart(2, "0")}Z</time><extensions>${ext}</extensions></trkpt>`;
  for (const version of [1, 2]) {
    const xml = `<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:s="http://www.garmin.com/xmlschemas/TrackPointExtension/v${version}"><trk><trkseg>${point(0, '<s:TrackPointExtension><s:hr>120</s:hr><s:cad>0</s:cad></s:TrackPointExtension><PowerInWatts xmlns="http://www.garmin.com/xmlschemas/PowerExtension/v1">0</PowerInWatts>')}${point(1, '<x:TrackPointExtension xmlns:x="http://www.garmin.com/xmlschemas/TrackPointExtension/v2"><x:hr>130</x:hr><x:cad>90</x:cad></x:TrackPointExtension><power>200</power>')}${point(2, '<s:TrackPointExtension xmlns:s="urn:unknown"><s:hr>250</s:hr></s:TrackPointExtension><unknown><s:TrackPointExtension><s:hr>240</s:hr></s:TrackPointExtension></unknown>')}${point(3, "<s:TrackPointExtension><s:hr>999</s:hr><s:cad>-1</s:cad></s:TrackPointExtension><power>3000</power>")}</trkseg></trk></gpx>`;
    const parsed = parseTrack(Buffer.from(xml));
    assert.equal(parsed.sensors.maxHr, 130);
    const samples = flat(deriveAnalysis(parsed, { owner: true }));
    assert.equal(samples[0].hrBpm, 120);
    assert.equal(samples[0].cadenceRpm, 0);
    assert.equal(samples[0].powerW, 0);
    assert.equal(samples[1].powerW, 200);
    for (const p of samples.slice(2))
      for (const key of ["hrBpm", "cadenceRpm", "powerW"])
        assert.equal(p[key], null);
  }
});

test("one SI contract for GPX/TCX/FIT; missing times/heights and stationary samples remain explicit", () => {
  for (const bytes of [gpx([loop]), tcx(loop), fit(loop)]) {
    const parsed = parseTrack(bytes),
      before = structuredClone(parsed.metrics);
    const s = deriveAnalysis(parsed, { owner: true });
    assert.equal(s.pointCount, loop.length);
    assert.equal(flat(s)[0].elapsedS, 0);
    assert.equal(flat(s)[0].speedMps, null);
    assert.equal(flat(s).at(-1).elapsedS, 2400);
    assert.ok(flat(s)[1].speedMps > 1 && flat(s)[1].speedMps < 20);
    assert.deepEqual(parsed.metrics, before);
    if (bytes !== null && parsed.format !== "gpx" && parsed.sensors.avgHr)
      assert.equal(flat(s)[0].hrBpm, 100);
  }
  const missing = deriveAnalysis(
    parseTrack(gpx([loop], { time: false, elevation: false })),
  );
  assert.ok(
    flat(missing).every(
      (p) =>
        p.elapsedS === null &&
        p.speedMps === null &&
        p.elevationM === null &&
        p.gradePct === null,
    ),
  );
  const paused = parseTrack(
    fit([loop[0], [loop[0][0], loop[0][1], 10, 100], ...loop.slice(1)]),
  );
  assert.equal(flat(deriveAnalysis(paused))[1].speedMps, 0);
  assert.equal(flat(deriveAnalysis(paused))[1].powerW, 250);
  assert.ok(
    paused.analysisSamples.flat().length > paused.samples.flat().length,
  );
});

test("segments, GPS loss, jumps, long pauses and invalid clocks never create interpolated speed", () => {
  const bytes = tcx([
    loop[0],
    loop[1],
    [null, null, 60, 100],
    ...loop.slice(3),
  ]);
  for (const data of [
    bytes,
    fit([loop[0], loop[1], [null, null, 60, 100], ...loop.slice(3)]),
    gpx([loop.slice(0, 30), loop.slice(30)]),
  ]) {
    const s = deriveAnalysis(parseTrack(data));
    assert.equal(s.segments.length, 2);
    assert.ok(s.segments.every((run) => run[0].speedMps === null));
  }
  const source = {
    samples: [
      [
        { coord: [0, 0], time: 10, ele: 100 },
        { coord: [0.001, 0], time: 20, ele: 90000 },
        { coord: [0.002, 0], time: 20, ele: null },
        { coord: [0.003, 0], time: 999, ele: 102 },
        { coord: [0.004, 0], time: 1009, ele: 103 },
      ],
    ],
  };
  const s = deriveAnalysis(source);
  assert.deepEqual(
    s.segments.map((r) => r.length),
    [2, 1, 2],
  );
  assert.equal(flat(s)[1].elevationM, null);
  assert.equal(flat(s).at(-1).elapsedS, 20);
  const jumped = deriveAnalysis(
    parseTrack(
      gpx([loop.slice(0, 20).concat([[0, 0, 600, 100]], loop.slice(21))]),
    ),
  );
  assert.ok(jumped.segments.length >= 2);
  assert.ok(flat(jumped).every((p) => p.speedMps == null || p.speedMps <= 45));
});

test("privacy precedes smoothing and time; public sensor grants are revocable and cannot leak through gap flags", () => {
  const parsed = parseTrack(
    fit([...loop, ...loop.slice(1).map((p) => [p[0], p[1], p[2] + 2400, 999])]),
  );
  const visible = deriveAnalysis(parsed, { privacy: true, radius: 500 });
  assert.ok(visible.pointCount < parsed.analysisSamples.flat().length);
  assert.equal(flat(visible)[0].distanceM, 0);
  assert.equal(flat(visible)[0].elapsedS, 0);
  assert.ok(visible.segments.length >= 2);
  for (const p of flat(visible)) {
    assert.ok(distance(loop[0], p.coord) >= 500);
    assert.ok(!("timestampS" in p));
  }
  const hidden = permittedAnalysis(visible, []);
  for (const p of flat(hidden)) {
    for (const k of ["hrBpm", "cadenceRpm", "powerW", "timestampS"])
      assert.ok(!(k in p));
    assert.equal(p.gaps & 0b111000, 0);
  }
  const shown = permittedAnalysis(visible, ["maxHr"]);
  assert.ok(shown.channels.includes("hrBpm"));
  assert.ok(!shown.channels.includes("powerW"));
  assert.ok(
    flat(
      permittedAnalysis(deriveAnalysis(parsed, { owner: true }), [], true),
    ).every((p) => Number.isFinite(p.timestampS)),
  );
  assert.equal(
    deriveAnalysis(parsed, { privacy: true, radius: 100000 }).pointCount,
    0,
  );
  assert.equal(permittedAnalysis({ version: 999 }), null);
  // Hidden elevations/timestamps cannot influence the first public value.
  const changed = structuredClone(parsed);
  for (const p of changed.analysisSamples.flat())
    if (distance(loop[0], p.coord) < 500) {
      p.ele = -400;
      p.time += 100000;
    }
  assert.deepEqual(
    deriveAnalysis(changed, { privacy: true, radius: 500 }),
    visible,
  );
});

test("200k decoded samples stay bounded, deterministic, preserve channel gaps and avoid privacy shortcuts", () => {
  const samples = Array.from({ length: 200000 }, (_, i) => ({
    coord: [37 + i * 0.000001, 55],
    time: i,
    ele: 100 + Math.sin(i / 100),
    hr: i === 40 ? null : 120,
  }));
  const start = performance.now();
  const s = deriveAnalysis({ samples: [samples] }, { owner: true });
  const duration = performance.now() - start;
  assert.ok(duration < 10000, `derive took ${duration}ms (10s CI budget)`);
  assert.equal(s.pointCount, ANALYSIS_LIMIT);
  assert.ok(Buffer.byteLength(JSON.stringify(s)) < 1024 * 1024);
  assert.deepEqual(flat(s)[0].coord, samples[0].coord);
  assert.deepEqual(flat(s).at(-1).coord, samples.at(-1).coord);
  assert.ok(flat(s)[1].gaps & (1 << analysisChannels.indexOf("hrBpm")));
  assert.deepEqual(deriveAnalysis({ samples: [samples] }, { owner: true }), s);
  // Many circles force decimation chords; none may pass through the hidden centre.
  const circle = Array.from({ length: 10000 }, (_, i) => ({
    coord: [0.0046 * Math.cos(i / 8), 0.0046 * Math.sin(i / 8)],
    time: i * 30,
    ele: 100,
  }));
  const center = { coord: [0, 0], time: -30, ele: 999 };
  const clipped = deriveAnalysis(
    { samples: [[center, ...circle, { ...center, time: 300000 }]] },
    { privacy: true, radius: 500 },
  );
  for (const run of clipped.segments)
    for (let i = 1; i < run.length; i++)
      assert.ok(lineDistance([0, 0], run[i - 1].coord, run[i].coord) >= 500);
  console.log(
    `analysis budget: 200000 samples → ${s.pointCount}, ${Math.round(duration)}ms, ${Buffer.byteLength(JSON.stringify(s))} bytes`,
  );
});

test("long allowed FIT is parsed once and yields bounded multi-channel series", () => {
  const route = Array.from({ length: 40000 }, (_, i) => [
    37 + i * 0.000001,
    55,
    i,
    100 + Math.sin(i / 100),
  ]);
  const bytes = fit(route);
  assert.ok(bytes.length < 10 * 1024 * 1024);
  const start = performance.now();
  const parsed = parseTrack(bytes);
  const series = permittedAnalysis(
    deriveAnalysis(parsed, { owner: true }),
    [],
    true,
  );
  assert.ok(performance.now() - start < 10000);
  assert.equal(series.sourcePointCount, route.length);
  assert.equal(series.pointCount, ANALYSIS_LIMIT);
  assert.ok(series.channels.includes("powerW"));
  assert.ok(series.channels.includes("hrBpm"));
});
