import test from "node:test";
import assert from "node:assert/strict";
import { parseTrack } from "../lib/ride-track.js";
import { parseFit, fitCrc } from "../lib/ride-fit.js";
import { parseTcx } from "../lib/ride-tcx.js";
import { gpx, fit, tcx, loop, crc16 } from "./ride-fixtures.js";

const expectedSensors = {
  avgHr: 110,
  maxHr: 120,
  avgCadence: 90,
  maxCadence: 90,
  avgPower: 200,
  maxPower: 250,
  maxSpeedMps: 7,
};
const rejects = (bytes, message, status = 400, limits) =>
  assert.throws(
    () => parseTrack(bytes, limits),
    (e) => e.status === status && message.test(e.message),
  );

test("FIT and TCX give the same route and metrics as GPX of the same points", () => {
  const reference = parseTrack(gpx([loop]));
  for (const bytes of [fit(loop), tcx(loop)]) {
    const parsed = parseTrack(bytes);
    // FIT stores coordinates as semicircles: speed differs in the 8th digit.
    const { avgSpeedMps, ...metrics } = parsed.metrics;
    const { avgSpeedMps: referenceSpeed, ...expected } = reference.metrics;
    assert.deepEqual(metrics, expected);
    assert.ok(Math.abs(avgSpeedMps - referenceSpeed) < 1e-6);
    assert.equal(parsed.geometry.length, 1);
    assert.equal(parsed.geometry[0].length, reference.geometry[0].length);
    assert.equal(parsed.samples[0].length, reference.samples[0].length);
    assert.deepEqual(parsed.sensors, expectedSensors);
  }
  assert.deepEqual(reference.sensors, {});
});

test("FIT variants: big-endian, compressed timestamps, developer fields, 12-byte header", () => {
  const plain = parseFit(fit(loop));
  for (const options of [
    { bigEndian: true },
    { compressed: true },
    { developer: true },
    { headerSize: 12 },
  ]) {
    const parsed = parseFit(fit(loop, options));
    assert.deepEqual(parsed.metrics, plain.metrics, JSON.stringify(options));
    assert.deepEqual(parsed.sensors, expectedSensors);
  }
  // Two files chained into one upload read as one track.
  const halves = [loop.slice(0, 41), loop.slice(40)];
  const chained = parseFit(Buffer.concat(halves.map((h) => fit(h))));
  assert.equal(chained.metrics.pointCount, 82);
});

test("sensors: missing values are not zeros, and points without GPS still count", () => {
  const none = parseTrack(fit(loop, { sensors: false }));
  assert.deepEqual(none.sensors, {});
  assert.equal(
    none.metrics.distanceM,
    parseTrack(gpx([loop])).metrics.distanceM,
  );
  // Waiting for a GPS fix: no position, but heart rate and power are real.
  const waiting = loop.map((p, i) => (i < 4 ? [null, null, p[2]] : p));
  for (const bytes of [fit(waiting), tcx(waiting)]) {
    const parsed = parseTrack(bytes);
    assert.equal(parsed.metrics.pointCount, 77);
    assert.equal(parsed.sensors.maxHr, 120);
  }
  assert.equal(
    parseTrack(tcx(loop, { sensors: false })).sensors.avgHr,
    undefined,
  );
});

test("TCX courses keep their name; activities have none", () => {
  assert.equal(
    parseTcx(tcx(loop, { course: true, name: "Вокруг озера" })).title,
    "Вокруг озера",
  );
  assert.equal(parseTcx(tcx(loop)).title, "");
});

test("damaged, foreign and oversized files get a clear error", () => {
  const good = fit(loop);
  const flipped = Buffer.from(good);
  flipped[200] ^= 0xff;
  rejects(flipped, /контрольная сумма/);
  rejects(good.subarray(0, good.length - 20), /повреждён или обрезан/);
  // Valid CRC, but the first record (after the 14-byte header, file_id
  // definition and data, record definition) names an undefined local type.
  const broken = Buffer.from(good);
  broken[14 + 12 + 6 + 30] = 0x0f;
  const c = crc16(broken.subarray(0, broken.length - 2));
  broken.writeUInt16LE(c, broken.length - 2);
  rejects(broken, /повреждён/);
  rejects(fit(loop.map((p) => [null, null, p[2]])), /без GPS/);
  rejects(tcx(loop.map((p) => [null, null, p[2]])), /без GPS/);
  rejects(fit(loop), /Слишком много точек FIT/, 413, { maxPoints: 10 });
  rejects(tcx(loop), /Слишком много точек TCX/, 413, { maxPoints: 10 });
  rejects(fit(loop), /слишком большой/, 413, { maxBytes: 100 });
  rejects(Buffer.from([0x50, 0x4b, 3, 4, 20, 0]), /Распакуйте архив/);
  rejects(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]), /GPX, TCX или FIT/);
  rejects(Buffer.alloc(0), /Пустой файл/);
  rejects(
    Buffer.from(
      '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><TrainingCenterDatabase/>',
    ),
    /DTD/,
  );
  rejects(
    Buffer.from(
      "<TrainingCenterDatabase><Activities><Activity><Lap><Track><Trackpoint><Position><LatitudeDegrees>95</LatitudeDegrees><LongitudeDegrees>0</LongitudeDegrees></Position></Trackpoint></Track></Lap></Activity></Activities></TrainingCenterDatabase>",
    ),
    /Некорректные координаты TCX/,
  );
});

test("FIT CRC is CRC-16/ARC and the same bytes hash the same", () => {
  assert.equal(fitCrc(Buffer.from("123456789")), 0xbb3d);
  assert.equal(crc16(Buffer.from("123456789")), 0xbb3d);
  assert.equal(
    parseTrack(fit(loop)).sourceHash,
    parseTrack(fit(loop)).sourceHash,
  );
  assert.notEqual(
    parseTrack(fit(loop)).sourceHash,
    parseTrack(tcx(loop)).sourceHash,
  );
});
