import type { Area } from "./ride-match-core.ts";
import { distanceM } from "./ride-match-core.ts";
import { coarsePoint } from "./map-settings.ts";

// The approximate area of a ride, an intent or a preference (#241, #370): one
// object — a label, and a centre with a radius that go together. Everything
// that changes a part of it goes through these helpers, so that the label, the
// centre and the radius always describe the same place.

/** The radii on offer, in kilometres (the server accepts 1–100 km). */
export const areaRadiiKm = [1, 2, 3, 5, 10, 20, 50, 100];
/** What a place found by name or a position gets until it is refined. */
export const defaultAreaRadiusM = 3000;
export const areaLabelMax = 100;

/** The radius, in metres, from the list that is nearest to `metres`. */
export function nearestRadiusM(metres: number) {
  const wanted = Number.isFinite(metres) ? metres : defaultAreaRadiusM;
  let best = areaRadiiKm[0];
  for (const km of areaRadiiKm)
    if (Math.abs(km * 1000 - wanted) < Math.abs(best * 1000 - wanted))
      best = km;
  return best * 1000;
}
/**
 * The radius that covers a place's bounding box
 * ([south, north, west, east] in degrees): half of its longer side, between 1
 * and 50 km — a district or a park, not a country.
 */
export function radiusForBox(box: readonly number[]) {
  const [south, north, west, east] = box;
  if (![south, north, west, east].every(Number.isFinite))
    return defaultAreaRadiusM;
  const middle = (south + north) / 2;
  const height = distanceM([west, south], [west, north]);
  const width = distanceM([west, middle], [east, middle]);
  return Math.min(50000, nearestRadiusM(Math.max(height, width) / 2));
}
/** A label as the server takes it: trimmed and not longer than it allows. */
export const cleanLabel = (text: string) =>
  text.replace(/\s+/g, " ").trim().slice(0, areaLabelMax);

/** An area with a centre and a radius: the part the matching can use. */
export const isMapped = (
  area?: Area | null,
): area is Area & { center: number[]; radiusM: number } =>
  !!area?.center && area.radiusM !== undefined;

/** A place the geosearch found, as an area: its name, a coarse centre, a radius. */
export function areaFromPlace(place: {
  label: string;
  center: number[];
  radiusM: number;
}): Area {
  return {
    label: cleanLabel(place.label),
    center: coarsePoint(place.center),
    radiusM: nearestRadiusM(place.radiusM),
  };
}
/**
 * An area around a position the device gave (#370): a coarse centre and the
 * default radius, no label — the person names it. The precise coordinates are
 * not kept: the centre is rounded here, before it reaches the form.
 */
export function areaFromPosition(position: {
  longitude: number;
  latitude: number;
}): Area {
  return {
    label: "",
    center: coarsePoint([position.longitude, position.latitude]),
    radiusM: defaultAreaRadiusM,
  };
}
/** The same area with another radius; a label-only area has none to change. */
export function withRadius(area: Area, radiusM: number): Area {
  return area.center
    ? { ...area, radiusM: nearestRadiusM(radiusM) }
    : { ...area };
}
/** The same area with another centre (a click on the map), a radius kept or default. */
export function withCenter(area: Area, center: number[]): Area {
  return {
    ...area,
    center: coarsePoint(center),
    radiusM: area.radiusM ?? defaultAreaRadiusM,
  };
}
/** The same area with another name: the geometry is not touched. */
export const withLabel = (area: Area, label: string): Area => ({
  ...area,
  label,
});
/** Back to a name only: the centre and the radius go together. */
export function withoutMap(area: Area): Area {
  const { center, radiusM, ...rest } = area;
  void center;
  void radiusM;
  return rest;
}
/**
 * What the server will accept of this area: a name, and a centre together with
 * a radius or neither. An empty list means the area can be saved as it is.
 */
export function areaProblems(area?: Area | null): string[] {
  if (!area) return [];
  const problems: string[] = [];
  if (!cleanLabel(area.label || ""))
    problems.push("Назовите область: подпись обязательна");
  if (!!area.center !== (area.radiusM !== undefined))
    problems.push("Для области на карте нужны центр и радиус");
  return problems;
}
/** One line for the summary of a chosen area. */
export function areaSummary(area: Area) {
  const name = cleanLabel(area.label || "") || "Без названия";
  return isMapped(area)
    ? `${name} · радиус ${area.radiusM / 1000} км`
    : `${name} · без привязки к карте`;
}
/**
 * The circle of an area as a closed ring of [longitude, latitude] points, for
 * the engines that draw polygons (MapLibre, Yandex). A flat approximation of the
 * sphere is enough at 1–100 km; the ring is only drawn, never compared.
 */
export function circleRing(center: number[], radiusM: number, steps = 64) {
  const [lon, lat] = center;
  const rad = Math.PI / 180;
  const dLat = radiusM / 6371000 / rad;
  const dLon = dLat / Math.max(Math.cos(lat * rad), 0.05);
  const ring: number[][] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    ring.push([
      lon + dLon * Math.cos(angle),
      Math.max(-85.0511, Math.min(85.0511, lat + dLat * Math.sin(angle))),
    ]);
  }
  ring.push([...ring[0]]);
  return ring;
}
/** [[west, south], [east, north]] of the circle: what a map fits into view. */
export function circleBounds(center: number[], radiusM: number) {
  const ring = circleRing(center, radiusM, 16);
  const lons = ring.map(([lon]) => lon),
    lats = ring.map(([, lat]) => lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}
