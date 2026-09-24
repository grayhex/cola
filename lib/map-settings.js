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
