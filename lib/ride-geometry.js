// Coordinates are [longitude, latitude]; never bridge segment or privacy gaps.
export const EARTH_M = 6371008.8;
const rad = Math.PI / 180;
export function distance(a, b) {
  const dlat = (b[1] - a[1]) * rad,
    dlon = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dlon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(Math.min(1, h)));
}
function projection(p, origin) {
  return [
    (p[0] - origin[0]) * rad * EARTH_M * Math.cos(origin[1] * rad),
    (p[1] - origin[1]) * rad * EARTH_M,
  ];
}
function lineDistance(p, a, b) {
  const [x, y] = projection(p, a),
    [dx, dy] = projection(b, a);
  const t = Math.max(
    0,
    Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(x - t * dx, y - t * dy);
}
export function simplify(points, tolerance = 8) {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]),
    stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = tolerance,
      index = -1;
    for (let i = a + 1; i < b; i++) {
      const d = lineDistance(points[i], points[a], points[b]);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (index !== -1) {
      keep.add(index);
      stack.push([a, index], [index, b]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}
export function bounds(segments) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of segments)
    for (const [x, y] of s) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}
export function publicGeometry(
  segments,
  enabled = false,
  radius = 500,
  simplifyResult = true,
) {
  const all = segments.filter((s) => s.length);
  if (!all.length) return [];
  const centers = [all[0][0], all.at(-1).at(-1)];
  const result = [];
  for (const segment of all) {
    let current = [];
    const flush = () => {
      if (current.length > 1) result.push(current);
      current = [];
    };
    for (const p of segment) {
      if (enabled && centers.some((c) => distance(c, p) < radius)) {
        flush();
        continue;
      }
      // Even sparse samples must not draw an edge through a hidden zone.
      if (
        enabled &&
        current.length &&
        centers.some((c) => lineDistance(c, current.at(-1), p) < radius)
      )
        flush();
      current.push(p);
    }
    flush();
  }
  if (!simplifyResult) return result;
  return result.map((s) => {
    const simplified = simplify(s);
    if (
      enabled &&
      simplified.some(
        (p, i) =>
          i &&
          centers.some((c) => lineDistance(c, simplified[i - 1], p) < radius),
      )
    )
      return s;
    return simplified;
  });
}
export function routePaths(segments, width = 640, height = 260, padding = 16) {
  const b = bounds(segments);
  if (!b) return [];
  const cos = Math.cos(((b[1] + b[3]) / 2) * rad),
    dx = (b[2] - b[0]) * cos,
    dy = b[3] - b[1];
  const scale = Math.min(
    (width - 2 * padding) / (dx || 1e-9),
    (height - 2 * padding) / (dy || 1e-9),
  );
  const ox = (width - dx * scale) / 2,
    oy = (height - dy * scale) / 2;
  return segments
    .filter((s) => s.length > 1)
    .map((s) =>
      s
        .map(
          (p, i) =>
            (i ? "L" : "M") +
            (ox + (p[0] - b[0]) * cos * scale).toFixed(2) +
            " " +
            (oy + (b[3] - p[1]) * scale).toFixed(2),
        )
        .join(" "),
    );
}
