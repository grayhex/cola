import { XMLParser, XMLValidator } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { distance } from "./ride-geometry.js";
export const GPX_THRESHOLDS = Object.freeze({
  movingMps: 1,
  maxMps: 45,
  maxUntimedJumpM: 10000,
  maxIntervalS: 300,
  elevationWindow: 5,
  ascentDeltaM: 3,
  maxDepth: 32,
});
export class RideError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const array = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const scalar = (v) => (v && typeof v === "object" ? v["#text"] : v);
function number(v) {
  const s = scalar(v);
  return s === undefined || s === null || String(s).trim() === ""
    ? null
    : Number(s);
}
function timestamp(v) {
  const s = scalar(v);
  if (
    typeof s !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s)
  )
    return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t / 1000 : null;
}
export function parseGpx(
  bytes,
  { maxBytes = 10 * 1024 * 1024, maxPoints = 200000 } = {},
) {
  if (!bytes.length) throw new RideError("Пустой GPX-файл");
  if (bytes.length > maxBytes)
    throw new RideError("GPX-файл слишком большой", 413);
  let xml;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RideError("GPX должен быть в кодировке UTF-8");
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml))
    throw new RideError("DTD и XML entities запрещены");
  // Bound nesting before recursive parsing, independently of file size.
  let depth = 0;
  for (const m of xml.matchAll(/<\/?[A-Za-z_][^>]*>/g)) {
    if (m[0].startsWith("</")) depth--;
    else if (!m[0].endsWith("/>")) depth++;
    if (depth > GPX_THRESHOLDS.maxDepth)
      throw new RideError("Слишком сложный GPX");
  }
  if (XMLValidator.validate(xml) !== true)
    throw new RideError("Некорректный XML");
  const doc = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    removeNSPrefix: true,
    parseTagValue: false,
    processEntities: false,
  }).parse(xml);
  if (
    !doc.gpx ||
    Object.keys(doc).some((k) => k !== "gpx" && !k.startsWith("?"))
  )
    throw new RideError("Нужен файл с корневым элементом GPX");
  let raw = array(doc.gpx.trk).flatMap((t) =>
    array(t.trkseg).map((s) => array(s.trkpt)),
  );
  if (!raw.some((s) => s.length))
    raw = array(doc.gpx.rte).map((r) => array(r.rtept));
  const count = raw.reduce((n, s) => n + s.length, 0);
  if (!count) throw new RideError("GPX не содержит маршрут");
  if (count > maxPoints) throw new RideError("Слишком много точек GPX", 413);
  const segments = [];
  let started = null,
    ended = null,
    distanceM = 0,
    movingDistance = 0,
    movingTime = 0,
    timedIntervals = 0,
    gain = 0,
    hasElevation = false;
  for (const section of raw) {
    let points = [],
      previous = null;
    const flush = () => {
      if (points.length >= 2) segments.push(points);
      points = [];
    };
    for (const p of section) {
      const lat = number(p["@lat"]),
        lon = number(p["@lon"]);
      if (
        lat === null ||
        lon === null ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      )
        throw new RideError("Некорректные координаты GPX");
      const ele = number(p.ele),
        time = timestamp(p.time),
        point = {
          coord: [lon, lat],
          ele: Number.isFinite(ele) ? ele : null,
          time,
        };
      if (time !== null) {
        if (started === null) started = time;
        ended = time;
      }
      if (previous) {
        const d = distance(previous.coord, point.coord),
          dt =
            time !== null && previous.time !== null
              ? time - previous.time
              : null;
        const jump =
          dt > 0
            ? d / dt > GPX_THRESHOLDS.maxMps
            : d > GPX_THRESHOLDS.maxUntimedJumpM;
        if (jump) {
          flush();
          // A discontinuity may start a valid new leg. Keep its first sample;
          // isolated spikes remain singletons and are discarded by flush().
          points.push(point);
          previous = point;
          continue;
        }
        distanceM += d;
        if (dt > 0 && dt <= GPX_THRESHOLDS.maxIntervalS) {
          timedIntervals++;
          if (d / dt >= GPX_THRESHOLDS.movingMps) {
            movingTime += dt;
            movingDistance += d;
          }
        }
        // Update time at stationary samples so a stop does not inflate moving time.
        if (d < 0.01) {
          previous = point;
          continue;
        }
      }
      points.push(point);
      previous = point;
    }
    flush();
  }
  for (const points of segments) {
    const elevations = points.map((p) => p.ele);
    let anchor = null;
    for (let i = 0; i < elevations.length; i++) {
      if (elevations[i] === null) {
        anchor = null;
        continue;
      }
      hasElevation = true;
      const window = elevations
        .slice(Math.max(0, i - 2), i + 3)
        .filter((v) => v !== null)
        .sort((a, b) => a - b);
      const e = window[Math.floor(window.length / 2)];
      if (anchor === null) anchor = e;
      else if (e - anchor >= GPX_THRESHOLDS.ascentDeltaM) {
        gain += e - anchor;
        anchor = e;
      } else if (anchor - e >= GPX_THRESHOLDS.ascentDeltaM) anchor = e;
    }
  }
  const geometry = segments.map((s) => s.map((p) => p.coord));
  if (!geometry.some((s) => s.length >= 2))
    throw new RideError("Недостаточно точек маршрута");
  return {
    sourceHash: createHash("sha256").update(bytes).digest("hex"),
    title: String(
      scalar(array(doc.gpx.trk)[0]?.name) ||
        scalar(array(doc.gpx.rte)[0]?.name) ||
        "",
    ).slice(0, 120),
    geometry,
    metrics: {
      startedAt:
        started === null ? null : new Date(started * 1000).toISOString(),
      endedAt: ended === null ? null : new Date(ended * 1000).toISOString(),
      distanceM: Math.round(distanceM),
      elapsedTimeS:
        started !== null && ended > started
          ? Math.round(ended - started)
          : null,
      movingTimeS: timedIntervals ? Math.round(movingTime) : null,
      avgSpeedMps: movingTime ? movingDistance / movingTime : null,
      elevationGainM: hasElevation ? Math.round(gain) : null,
      pointCount: count,
    },
  };
}
