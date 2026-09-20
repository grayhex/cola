export const yandexGroundLayerId = "cola-yandex-ground";

// Input is the viewer-specific geometry returned by the existing rides API.
// Keep segments separate and discard metadata; never reconnect privacy gaps.
export function yandexRoute(geometry) {
  const segments = [];
  for (const line of Array.isArray(geometry) ? geometry : []) {
    let segment = [];
    for (const point of Array.isArray(line) ? line : []) {
      if (Array.isArray(point) && Number.isFinite(point[0]) &&
          Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 &&
          Math.abs(point[1]) <= 85.0511) {
        segment.push([point[0], point[1]]);
      } else {
        if (segment.length >= 2) segments.push(segment);
        segment = [];
      }
    }
    if (segment.length >= 2) segments.push(segment);
  }
  if (!segments.length) return null;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const line of segments) for (const [lon, lat] of line) {
    west = Math.min(west, lon); east = Math.max(east, lon);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  // Non-zero bounds also keep tiny/stationary tracks from zooming in too far.
  const dx = Math.max((east - west) * 0.06, 0.001);
  const dy = Math.max((north - south) * 0.06, 0.001);
  return {
    segments,
    bounds: [[Math.max(-180, west - dx), Math.max(-85.0511, south - dy)],
      [Math.min(180, east + dx), Math.min(85.0511, north + dy)]],
    start: segments[0][0],
    finish: segments.at(-1).at(-1),
  };
}

export function createYandexRideMap(api, container, route, {
  color = "#e7482f", scrollZoom = false, markerClass = "",
  onReady = () => {}, onUnavailable = () => {}, timeoutMs = 15000,
} = {}) {
  let map;
  let disposed = false;
  let ready = false;
  let timer;
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    map?.destroy();
  };
  try {
    map = new api.YMap(container, {
      location: { bounds: route.bounds },
      margin: [36, 36, 36, 36],
      mode: "raster",
      zoomRange: { min: 0, max: 19 },
      behaviors: ["drag", "pinchZoom", "dblClick", ...(scrollZoom ? ["scrollZoom"] : [])],
    });
    timer = setTimeout(() => {
      if (disposed || ready) return;
      destroy();
      onUnavailable();
    }, timeoutMs);
    map.addChild(new api.YMapListener({
      onStateChanged: (state) => {
        if (disposed || ready) return;
        const tiles = state.getLayerState(yandexGroundLayerId, "tile", "raster");
        if (tiles?.tilesReady > 0) {
          ready = true;
          clearTimeout(timer);
          onReady();
        }
      },
    }));
    map.addChild(new api.YMapDefaultSchemeLayer({
      layers: { ground: { id: yandexGroundLayerId } },
    }));
    map.addChild(new api.YMapDefaultFeaturesLayer({}));
    for (const [i, coordinates] of route.segments.entries()) {
      map.addChild(new api.YMapFeature({
        id: `ride-segment-${i}`,
        geometry: { type: "LineString", coordinates },
        style: { stroke: [{ color, width: 4 }] },
      }));
    }
    for (const [coordinates, label, kind] of [
      [route.start, "Начало видимой части маршрута", "start"],
      [route.finish, "Конец видимой части маршрута", "finish"],
    ]) {
      const element = container.ownerDocument.createElement("span");
      element.className = markerClass;
      element.dataset.kind = kind;
      element.title = label;
      element.setAttribute("aria-label", label);
      element.setAttribute("role", "img");
      map.addChild(new api.YMapMarker({ coordinates }, element));
    }
    return {
      destroy,
      zoom: (delta) => {
        if (!disposed) map.setLocation({ zoom: Math.min(19, Math.max(0, map.zoom + delta)), duration: 200 });
      },
      fit: () => {
        if (!disposed) map.setLocation({ bounds: route.bounds, duration: 200 });
      },
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
