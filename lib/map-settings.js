/**
 * Map provider from Система → Карты; mapInput in admin-validation.js checks it.
 * @typedef {object} MapSettings
 * @property {boolean} enabled
 * @property {"osm" | "yandex" | "raster" | "style"} provider
 * @property {string} tileUrl
 * @property {string} styleUrl
 * @property {string} publicKey
 * @property {string} attribution
 */
/** @type {MapSettings} */
export const mapDefaults = {
  enabled: true,
  provider: "osm",
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  styleUrl: "",
  publicKey: "",
  attribution: "© OpenStreetMap contributors",
};
export const osmAttribution = "https://www.openstreetmap.org/copyright";
export function isRasterProvider(config) {
  return config.provider === "osm" || config.provider === "raster";
}
export function tileTemplate(config) {
  if (!isRasterProvider(config)) return "";
  return (
    config.provider === "osm" ? mapDefaults.tileUrl : config.tileUrl
  ).replaceAll("{key}", encodeURIComponent(config.publicKey || ""));
}
export function mapStyle(config) {
  // Yandex has its own SDK renderer, never a MapLibre/XYZ tile endpoint.
  if (!config.enabled || config.provider === "yandex") return null;
  if (config.provider === "style")
    return config.styleUrl.replaceAll(
      "{key}",
      encodeURIComponent(config.publicKey || ""),
    );
  // Attribution is rendered by React outside the canvas, never interpreted as HTML.
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [tileTemplate(config)],
        tileSize: 256,
        maxzoom: 19,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  };
}
// Web Mercator viewport for bounded, visible-only raster previews (no prefetch).
export function rasterViewport(geometry, width = 640, height = 260) {
  const project = ([lon, lat]) => {
    const s = Math.sin(
      (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180,
    );
    return [
      (lon + 180) / 360,
      0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI),
    ];
  };
  const segments = geometry.map((line) => line.map(project)),
    points = segments.flat();
  if (!points.length) return null;
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const [x, y] of points) {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const zoom = Math.max(
    0,
    Math.min(
      15,
      Math.floor(
        Math.log2(
          Math.min(
            (width - 48) / Math.max(right - left, 1e-8),
            (height - 48) / Math.max(bottom - top, 1e-8),
          ) / 256,
        ),
      ),
    ),
  );
  const size = 256 * 2 ** zoom,
    ox = ((left + right) * size) / 2 - width / 2,
    oy = ((top + bottom) * size) / 2 - height / 2,
    tiles = [];
  for (let y = Math.floor(oy / 256); y <= Math.floor((oy + height) / 256); y++)
    for (
      let x = Math.floor(ox / 256);
      x <= Math.floor((ox + width) / 256);
      x++
    ) {
      if (y < 0 || y >= 2 ** zoom) continue;
      tiles.push({
        z: zoom,
        x: ((x % 2 ** zoom) + 2 ** zoom) % 2 ** zoom,
        y,
        left: x * 256 - ox,
        top: y * 256 - oy,
      });
    }
  return {
    tiles,
    point: (coord) => {
      const [x, y] = project(coord);
      return [x * size - ox, y * size - oy];
    },
    paths: segments.map((line) =>
      line
        .map(
          ([x, y], i) =>
            (i ? "L" : "M") +
            (x * size - ox).toFixed(2) +
            "," +
            (y * size - oy).toFixed(2),
        )
        .join(" "),
    ),
  };
}
// Web Mercator window around one point, for the coarse area picker (#241).
// Pure: the caller decides whether tiles may be requested at all.
const worldSize = (zoom) => 256 * 2 ** zoom;
/** @param {number[]} coord [lon, lat] @param {number} zoom @returns {number[]} world pixels */
export function projectPoint([lon, lat], zoom) {
  const s = Math.sin(
    (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180,
  );
  const size = worldSize(zoom);
  return [
    ((lon + 180) / 360) * size,
    (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size,
  ];
}
/** @param {number[]} point world pixels @param {number} zoom @returns {number[]} [lon, lat] */
export function unprojectPoint([x, y], zoom) {
  const size = worldSize(zoom);
  const lon = (x / size) * 360 - 180;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;
  return [((((lon + 180) % 360) + 360) % 360) - 180, lat];
}
/** Ground metres per screen pixel at a latitude. */
export function metersPerPixel(lat, zoom) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}
/** Stored areas keep 0.01° (~1 km); the picker never holds more precision. */
export const coarsePoint = (/** @type {number[]} */ [lon, lat]) => [
  Math.round(Math.max(-180, Math.min(180, lon)) * 100) / 100,
  Math.round(Math.max(-85, Math.min(85, lat)) * 100) / 100,
];
/** Tiles and helpers for a width×height window centred on `center`.
 * @param {number[]} center @param {number} zoom @param {number} width @param {number} height */
export function pointViewport(center, zoom, width = 640, height = 320) {
  const [cx, cy] = projectPoint(center, zoom),
    ox = cx - width / 2,
    oy = cy - height / 2,
    count = 2 ** zoom,
    tiles = [];
  for (let y = Math.floor(oy / 256); y <= Math.floor((oy + height) / 256); y++)
    for (let x = Math.floor(ox / 256); x <= Math.floor((ox + width) / 256); x++)
      if (y >= 0 && y < count)
        tiles.push({
          z: zoom,
          x: ((x % count) + count) % count,
          y,
          left: x * 256 - ox,
          top: y * 256 - oy,
        });
  return {
    tiles,
    /** @param {number[]} coord */
    point: (coord) => {
      const [x, y] = projectPoint(coord, zoom);
      return [x - ox, y - oy];
    },
    /** @param {number} left @param {number} top */
    coordAt: (left, top) => unprojectPoint([ox + left, oy + top], zoom),
    /** @param {number} meters */
    pixels: (meters) => meters / metersPerPixel(center[1], zoom),
  };
}
