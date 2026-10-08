import test from "node:test";
import assert from "node:assert/strict";
import {
  areaFromPlace,
  areaFromPosition,
  areaProblems,
  areaRadiiKm,
  areaSummary,
  circleBounds,
  circleRing,
  cleanLabel,
  defaultAreaRadiusM,
  isMapped,
  nearestRadiusM,
  radiusForBox,
  withCenter,
  withLabel,
  withRadius,
  withoutMap,
} from "../lib/ride-area.ts";
import { distanceM } from "../lib/ride-match-core.ts";
import { rideAreaInput } from "../lib/ride-plan.ts";

// #370: the label, the centre and the radius of an area are one object; every
// change keeps them describing the same place, and what the helpers make is
// what the server accepts.
test("radii: only the ones on offer, the nearest to what is asked", () => {
  assert.deepEqual(areaRadiiKm, [1, 2, 3, 5, 10, 20, 50, 100]);
  assert.equal(nearestRadiusM(1), 1000);
  assert.equal(nearestRadiusM(3400), 3000);
  assert.equal(nearestRadiusM(4100), 5000);
  assert.equal(nearestRadiusM(15000), 10000);
  assert.equal(nearestRadiusM(1e9), 100000);
  assert.equal(nearestRadiusM(Number.NaN), defaultAreaRadiusM);
});

test("a radius that covers a place's box: half of the longer side, a district and not a country", () => {
  // ~2 km wide, ~2.2 km high around Moscow: a 1 km radius covers it.
  assert.equal(radiusForBox([55.78, 55.8, 37.65, 37.68]), 1000);
  // A park of about 6 × 4 km.
  assert.equal(radiusForBox([55.77, 55.82, 37.7, 37.78]), 3000);
  // A whole region is bounded by 50 km.
  assert.equal(radiusForBox([54, 57, 35, 39]), 50000);
  assert.equal(radiusForBox([Number.NaN, 1, 2, 3]), defaultAreaRadiusM);
  assert.equal(radiusForBox([1, 2]), defaultAreaRadiusM);
});

test("areas made from a place or a position are what the server accepts, with coarse centres", () => {
  const fromPlace = areaFromPlace({
    label: "  Измайловский   парк ",
    center: [37.7512, 55.7934],
    radiusM: 3400,
  });
  assert.deepEqual(fromPlace, {
    label: "Измайловский парк",
    center: [37.75, 55.79],
    radiusM: 3000,
  });
  assert.ok(rideAreaInput.parse(fromPlace));
  assert.ok(isMapped(fromPlace));

  // A position gives a coarse centre and the default radius, and no name: the
  // person names it, and until then it does not pass.
  const here = areaFromPosition({ longitude: 37.6173, latitude: 55.7558 });
  assert.deepEqual(here.center, [37.62, 55.76]);
  assert.equal(here.radiusM, defaultAreaRadiusM);
  assert.equal(here.label, "");
  assert.deepEqual(areaProblems(here), [
    "Назовите область: подпись обязательна",
  ]);
  assert.deepEqual(areaProblems(withLabel(here, "Рядом с домом")), []);
  assert.equal(
    rideAreaInput.safeParse(withLabel(here, "Рядом с домом")).success,
    true,
  );
});

test("a change keeps the area one: the name does not move the circle, the circle does not rename", () => {
  const area = { label: "Сокольники", center: [37.67, 55.79], radiusM: 3000 };
  assert.deepEqual(withLabel(area, "Парк"), { ...area, label: "Парк" });
  assert.deepEqual(withRadius(area, 9000), { ...area, radiusM: 10000 });
  assert.deepEqual(withCenter(area, [37.6123, 55.7456]), {
    label: "Сокольники",
    center: [37.61, 55.75],
    radiusM: 3000,
  });
  // A label-only area gets a default radius with a centre, never a half pair.
  const named = { label: "Парк" };
  assert.deepEqual(withRadius(named, 5000), named);
  assert.deepEqual(withCenter(named, [37.6, 55.7]), {
    label: "Парк",
    center: [37.6, 55.7],
    radiusM: defaultAreaRadiusM,
  });
  // Back to a name only: the centre and the radius go together.
  assert.deepEqual(withoutMap(area), { label: "Сокольники" });
  assert.equal(isMapped(withoutMap(area)), false);
});

test("problems and the one-line summary", () => {
  assert.deepEqual(areaProblems(null), []);
  assert.deepEqual(areaProblems({ label: "Парк" }), []);
  assert.deepEqual(areaProblems({ label: "  " }), [
    "Назовите область: подпись обязательна",
  ]);
  assert.deepEqual(areaProblems({ label: "Парк", center: [37, 55] }), [
    "Для области на карте нужны центр и радиус",
  ]);
  assert.deepEqual(areaProblems({ label: "Парк", radiusM: 3000 }), [
    "Для области на карте нужны центр и радиус",
  ]);
  assert.equal(
    areaSummary({ label: "Сокольники", center: [37.67, 55.79], radiusM: 5000 }),
    "Сокольники · радиус 5 км",
  );
  assert.equal(areaSummary({ label: "Парк" }), "Парк · без привязки к карте");
  assert.equal(
    areaSummary({ label: "" }),
    "Без названия · без привязки к карте",
  );
  assert.equal(cleanLabel("a ".repeat(80)).length, 100);
});

test("the circle of an area is a closed ring at the radius from its centre, and a box that holds it", () => {
  const center = [37.62, 55.75];
  for (const radiusM of [1000, 5000, 100000]) {
    const ring = circleRing(center, radiusM);
    assert.deepEqual(ring[0], ring.at(-1), "a polygon is closed");
    assert.equal(ring.length, 65);
    for (const point of ring) {
      const away = distanceM(center, point);
      assert.ok(
        Math.abs(away - radiusM) / radiusM < 0.01,
        `${radiusM} m: a point ${Math.round(away)} m away`,
      );
    }
    const [[west, south], [east, north]] = circleBounds(center, radiusM);
    assert.ok(west < center[0] && east > center[0]);
    assert.ok(south < center[1] && north > center[1]);
  }
  // Near the pole the ring stays on the map and does not turn into NaN.
  const high = circleRing([30, 84], 100000);
  assert.ok(high.every(([lon, lat]) => Number.isFinite(lon) && lat <= 85.0511));
});
