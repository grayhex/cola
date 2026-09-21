import { distance, publicGeometry } from "./ride-geometry.js";
import { GPX_THRESHOLDS } from "./ride-gpx.js";

// Only visible intervals are retained. No coordinates, absolute timestamps or
// hidden-zone distances enter this public DTO. Gaps are never interpolated.
export function speedProfile(samples, privacyEnabled, radius, limit = 180) {
  const times = new Map(
    samples.flat().map((point) => [point.coord, point.time]),
  );
  const visible = publicGeometry(
    samples.map((segment) => segment.map((point) => point.coord)),
    privacyEnabled,
    radius,
    false,
  );
  const runs = [];
  let distanceM = 0;
  for (const segment of visible) {
    let run = [];
    const flush = () => {
      if (run.length) runs.push(run);
      run = [];
    };
    for (let i = 1; i < segment.length; i++) {
      const a = segment[i - 1],
        b = segment[i];
      const start = times.get(a),
        end = times.get(b);
      const elapsed = start !== null && end !== null ? end - start : null;
      const meters = distance(a, b);
      distanceM += meters;
      if (
        !(elapsed > 0 && elapsed <= GPX_THRESHOLDS.maxIntervalS) ||
        meters / elapsed > GPX_THRESHOLDS.maxMps
      ) {
        flush();
        continue;
      }
      run.push({
        distanceKm: Math.round(distanceM) / 1000,
        speedKmh: Math.round((meters / elapsed) * 36) / 10,
      });
    }
    flush();
  }
  const total = runs.reduce((n, run) => n + run.length, 0);
  if (total <= limit) return runs;
  // Allocate a bounded number of samples across runs without bridging gaps.
  const stride = Math.ceil(total / limit);
  let index = 0;
  return runs
    .map((run) => run.filter(() => index++ % stride === 0))
    .filter((run) => run.length);
}
