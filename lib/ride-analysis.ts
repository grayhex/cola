import { distance, lineDistance, publicGeometry } from "./ride-geometry.ts";
import { GPX_THRESHOLDS } from "./ride-gpx.ts";
import type { ParsedTrack, Sample } from "./ride-gpx.ts";
import type { Queryable } from "./db.ts";
import type {
  AnalysisPoint,
  AnalysisSeries,
  AnalysisChannel,
} from "./ride-analysis-contract.ts";

import {
  ANALYSIS_VERSION,
  ANALYSIS_LIMIT,
  analysisChannels,
} from "./ride-analysis-contract.ts";
export {
  ANALYSIS_VERSION,
  ANALYSIS_LIMIT,
  analysisChannels,
} from "./ride-analysis-contract.ts";
const valid = (value: number | null | undefined, min: number, max: number) =>
  value != null && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
const rounded = (value: number | null, digits = 2) =>
  value === null ? null : Number(value.toFixed(digits));

// Derive before decimation. Privacy is applied to the original samples before
// smoothing, gradients, relative distance/time or sampling can reveal a hidden leg.
export function deriveAnalysis(
  parsed: ParsedTrack,
  { privacy = false, radius = 500, owner = false } = {},
) {
  const source = parsed.analysisSamples || parsed.samples;
  const byCoordinate = new Map<number[], Sample>();
  for (const run of source)
    for (const point of run) byCoordinate.set(point.coord, point);
  const visible = publicGeometry(
    source.map((run) => run.map((p) => p.coord)),
    privacy,
    radius,
    false,
  );
  const runs: Sample[][] = [];
  for (const coords of visible) {
    let run: Sample[] = [];
    for (const coord of coords) {
      // publicGeometry retains the source coordinate objects.
      const p = byCoordinate.get(coord)!,
        previous = run.at(-1);
      const dt =
        p.time !== null && previous?.time != null
          ? p.time - previous.time
          : null;
      if (
        previous &&
        (p.analysisBreak ||
          (dt !== null && (dt <= 0 || dt > GPX_THRESHOLDS.maxIntervalS)))
      ) {
        runs.push(run);
        run = [];
      }
      run.push(p);
    }
    if (run.length) runs.push(run);
  }
  const total = runs.reduce((n, r) => n + r.length, 0);
  // Deterministic global sampling, including first/last. Kept samples retain
  // their segment; omitted segments are never joined to a neighbour.
  const keep = new Set(
    Array.from({ length: Math.min(total, ANALYSIS_LIMIT) }, (_, i) =>
      Math.round(
        (i * (total - 1)) / Math.max(1, Math.min(total, ANALYSIS_LIMIT) - 1),
      ),
    ),
  );
  const nonempty = source.filter((run) => run.length);
  const centers = nonempty.length
    ? [nonempty[0][0].coord, nonempty[nonempty.length - 1].slice(-1)[0].coord]
    : [];
  const segments: AnalysisPoint[][] = [];
  let index = 0,
    distanceM = 0,
    elapsedS = 0;
  const firstTime = runs.flat().find((p) => p.time !== null)?.time;
  for (const run of runs) {
    const values = run.map((p) => valid(p.ele, -500, 9000));
    const elevation = values.map((v, i) => {
      if (v === null) return null;
      const window = values
        .slice(Math.max(0, i - 2), i + 3)
        .filter((v) => v !== null)
        .sort((a, b) => a - b);
      return window[Math.floor(window.length / 2)];
    });
    let output: AnalysisPoint[] = [];
    let gaps = 0;
    for (let i = 0; i < run.length; i++, index++) {
      const p = run[i],
        previous = run[i - 1];
      const meters = previous ? distance(previous.coord, p.coord) : 0;
      const dt =
        previous && p.time !== null && previous.time !== null
          ? p.time - previous.time
          : null;
      const timed = dt !== null && dt > 0 && dt <= GPX_THRESHOLDS.maxIntervalS;
      distanceM += meters;
      if (timed) elapsedS += dt;
      const speed = timed ? valid(meters / dt, 0, GPX_THRESHOLDS.maxMps) : null;
      const grade =
        i && meters >= 5 && elevation[i] !== null && elevation[i - 1] !== null
          ? valid((100 * (elevation[i]! - elevation[i - 1]!)) / meters, -60, 60)
          : null;
      const point = {
        coord: p.coord,
        distanceM: rounded(distanceM),
        elapsedS:
          p.time === null
            ? null
            : rounded(
                owner
                  ? firstTime != null && p.time >= firstTime
                    ? p.time - firstTime
                    : null
                  : elapsedS,
              ),
        elevationM: rounded(elevation[i]),
        speedMps: rounded(speed),
        gradePct: rounded(grade),
        hrBpm: valid(p.hr, 1, 254),
        cadenceRpm: valid(p.cadence, 0, 254),
        powerW: valid(p.power, 0, 2999),
        ...(owner ? { timestampS: p.time } : {}),
      };
      analysisChannels.forEach((key, bit) => {
        if (point[key] === null) gaps |= 1 << bit;
      });
      if (keep.has(index)) {
        if (
          privacy &&
          output.length &&
          centers.some(
            (c) =>
              lineDistance(c, output[output.length - 1].coord, point.coord) <
              radius,
          )
        ) {
          segments.push(output);
          output = [];
        }
        output.push({ ...point, gaps });
        gaps = 0;
      }
    }
    if (output.length) segments.push(output);
  }
  return {
    version: ANALYSIS_VERSION,
    visibility: owner ? "owner" : "public",
    sourcePointCount: total,
    pointCount: segments.reduce((n, r) => n + r.length, 0),
    downsampled: total > ANALYSIS_LIMIT,
    segments,
  };
}

// An explicitly selected avg/max sensor metric grants its corresponding channel.
// Apply this on EVERY read, so revoking a field takes effect without a backfill.
export function permittedAnalysis(
  series: AnalysisSeries | null | undefined,
  visibleMetrics: string[] = [],
  owner = false,
) {
  if (!series || series.version !== ANALYSIS_VERSION) return null;
  const allowed = new Set(visibleMetrics);
  const sensorFields = {
    hrBpm: ["avgHr", "maxHr"],
    cadenceRpm: ["avgCadence", "maxCadence"],
    powerW: ["avgPower", "maxPower"],
  };
  const hidden = Object.entries(sensorFields)
    .filter(([, fields]) => !owner && !fields.some((f) => allowed.has(f)))
    .map(([key]) => key as AnalysisChannel);
  const segments = series.segments.map((run) =>
    run.map((p) => {
      const result = { ...p };
      if (!owner) delete result.timestampS;
      for (const key of hidden) {
        delete result[key];
        result.gaps &= ~(1 << analysisChannels.indexOf(key));
      }
      return result;
    }),
  );
  const channels = analysisChannels.filter(
    (key) =>
      !hidden.includes(key) &&
      segments.some((run) => run.some((p) => p[key] != null)),
  );
  return { ...series, segments, channels };
}

export async function storeRideAnalysis(
  q: Queryable,
  rideId: string,
  parsed: ParsedTrack,
  privacy: boolean,
  radius: number,
) {
  await q.query(
    `INSERT INTO ride_analysis(ride_id,version,source_hash,privacy_enabled,privacy_radius_m,owner_series,public_series)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(ride_id) DO UPDATE SET version=EXCLUDED.version,source_hash=EXCLUDED.source_hash,privacy_enabled=EXCLUDED.privacy_enabled,privacy_radius_m=EXCLUDED.privacy_radius_m,owner_series=EXCLUDED.owner_series,public_series=EXCLUDED.public_series`,
    [
      rideId,
      ANALYSIS_VERSION,
      parsed.sourceHash,
      privacy,
      radius,
      JSON.stringify(deriveAnalysis(parsed, { owner: true })),
      JSON.stringify(deriveAnalysis(parsed, { privacy, radius })),
    ],
  );
}
