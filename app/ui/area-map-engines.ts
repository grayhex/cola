import type { GeoJSONSource, Map as LibreMap } from "maplibre-gl";
import type { Area } from "../../lib/ride-match-core.ts";
import type { YandexMap } from "../../lib/yandex-maps-contract.ts";
import { circleBounds, circleRing, isMapped } from "../../lib/ride-area.ts";
import { loadYandexMaps } from "../../lib/yandex-maps.ts";
import { yandexGroundLayerId } from "../../lib/yandex-ride-map.ts";

// The maps that choose an area when the site's map is not a plain raster one
// (#370): a MapLibre style and the Yandex SDK. Both draw the same thing — the
// circle of the chosen area and its centre — and answer the same few calls, so
// the picker above them does not care which engine it holds. Raster maps keep
// the SVG picker in `ride-area-map.tsx`.
export type AreaMapHandle = {
  /** Draws the area (or nothing); `fit` also brings it into view. */
  show: (area: Area | null, fit: boolean) => void;
  /** The centre of what the map shows now: a place for the «centre here» button. */
  center: () => number[];
  zoom: (delta: number) => void;
  destroy: () => void;
};
export type AreaMapOptions = {
  center: number[];
  zoom: number;
  /** A CSS colour for the circle: the accent of the page. */
  color: string;
  /** A click or tap: the point to put the centre at. */
  onPick: (point: number[]) => void;
  /** The base map is drawn. */
  onReady: () => void;
  /** The map cannot be used; the person goes on by name. */
  onError: (reason: "unavailable" | "reload") => void;
  /** An element class for the centre dot (engines that draw it as an element). */
  dotClass?: string;
  /** The Yandex SDK failed before: the person asked to try again. */
  retry?: boolean;
};
const point = (value: unknown) =>
  Array.isArray(value) &&
  value.length >= 2 &&
  Number.isFinite(value[0]) &&
  Number.isFinite(value[1])
    ? [Number(value[0]), Number(value[1])]
    : null;
const loadTimeoutMs = 20000;

const sourceId = "area",
  layers = ["area-fill", "area-line", "area-center"] as const;
type AreaFeature = {
  type: "Feature";
  properties: Record<string, never>;
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "Point"; coordinates: number[] };
};
function areaData(area: Area | null) {
  const features: AreaFeature[] = [];
  if (area && isMapped(area)) {
    features.push(
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [circleRing(area.center, area.radiusM)],
        },
      },
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: area.center },
      },
    );
  }
  return { type: "FeatureCollection" as const, features };
}

/** A MapLibre map on the style the administrator set («style» provider). */
export async function createLibreAreaMap(
  container: HTMLElement,
  style: string,
  options: AreaMapOptions,
): Promise<AreaMapHandle> {
  const lib = await import("maplibre-gl");
  lib.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
  let map: LibreMap | undefined,
    loaded = false,
    disposed = false,
    pending: { area: Area | null; fit: boolean } | null = null;
  const timer = setTimeout(() => {
    if (!loaded && !disposed) options.onError("unavailable");
  }, loadTimeoutMs);
  const destroy = () => {
    disposed = true;
    clearTimeout(timer);
    map?.remove();
    map = undefined;
  };
  try {
    // A browser without WebGL throws here: the caller turns it into a message.
    const instance = new lib.Map({
      container,
      style,
      center: [options.center[0], options.center[1]],
      zoom: options.zoom,
      attributionControl: {},
    });
    map = instance;
    const draw = (area: Area | null, fit: boolean) => {
      const source = instance.getSource(sourceId) as GeoJSONSource | undefined;
      source?.setData(areaData(area));
      if (fit && area && isMapped(area)) {
        const [[west, south], [east, north]] = circleBounds(
          area.center,
          area.radiusM,
        );
        instance.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 28, maxZoom: 15, duration: 0 },
        );
      }
    };
    instance.on("error", () => {
      // A tile that does not come is the map's business; a style that does not
      // come leaves nothing to choose on.
      if (!loaded && !disposed) options.onError("unavailable");
    });
    instance.on("load", () => {
      if (disposed) return;
      instance.addSource(sourceId, { type: "geojson", data: areaData(null) });
      instance.addLayer({
        id: layers[0],
        type: "fill",
        source: sourceId,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": options.color, "fill-opacity": 0.18 },
      });
      instance.addLayer({
        id: layers[1],
        type: "line",
        source: sourceId,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "line-color": options.color, "line-width": 2 },
      });
      instance.addLayer({
        id: layers[2],
        type: "circle",
        source: sourceId,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 5,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#111827",
          "circle-stroke-width": 2,
        },
      });
      loaded = true;
      clearTimeout(timer);
      if (pending) draw(pending.area, pending.fit);
      options.onReady();
    });
    instance.on("click", (event) => {
      const clicked = point([event.lngLat.lng, event.lngLat.lat]);
      if (clicked) options.onPick(clicked);
    });
    return {
      show: (area, fit) => {
        if (disposed) return;
        if (loaded) draw(area, fit);
        else pending = { area, fit };
      },
      center: () => {
        const middle = instance.getCenter();
        return [middle.lng, middle.lat];
      },
      zoom: (delta) => {
        if (!disposed)
          instance.easeTo({ zoom: instance.getZoom() + delta, duration: 150 });
      },
      destroy,
    };
  } catch (error) {
    destroy();
    throw error;
  }
}

/** The Yandex SDK map («yandex» provider): the same circle, drawn by the SDK. */
export async function createYandexAreaMap(
  container: HTMLElement,
  publicKey: string,
  options: AreaMapOptions,
): Promise<AreaMapHandle> {
  const api = await loadYandexMaps(publicKey, { retry: !!options.retry });
  let map: YandexMap | undefined,
    disposed = false,
    ready = false,
    shown: unknown[] = [];
  const timer = setTimeout(() => {
    // Slow tiles are recoverable: the map stays and a late tile still makes it
    // ready. Only the message says it takes long.
    if (!ready && !disposed) options.onError("unavailable");
  }, loadTimeoutMs);
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    map?.destroy();
    map = undefined;
  };
  try {
    const instance = new api.YMap(container, {
      location: { center: options.center, zoom: options.zoom },
      margin: [28, 28, 28, 28],
      mode: "raster",
      zoomRange: { min: 3, max: 19 },
      behaviors: ["drag", "pinchZoom", "dblClick", "scrollZoom"],
    });
    map = instance;
    instance.addChild(
      new api.YMapListener({
        layer: "any",
        onClick: (_object, event) => {
          const clicked = point(event?.coordinates);
          if (clicked) options.onPick(clicked);
        },
        onStateChanged: (state) => {
          if (disposed || ready) return;
          const tiles = state.getLayerState(
            yandexGroundLayerId,
            "tile",
            "raster",
          );
          if ((tiles?.tilesReady ?? 0) > 0) {
            ready = true;
            clearTimeout(timer);
            options.onReady();
          }
        },
      }),
    );
    instance.addChild(
      new api.YMapDefaultSchemeLayer({
        layers: { ground: { id: yandexGroundLayerId } },
      }),
    );
    instance.addChild(new api.YMapDefaultFeaturesLayer({}));
    return {
      show: (area, fit) => {
        if (disposed) return;
        for (const child of shown) instance.removeChild(child);
        shown = [];
        if (!area || !isMapped(area)) return;
        const circle = new api.YMapFeature({
          id: "area-circle",
          geometry: {
            type: "Polygon",
            coordinates: [circleRing(area.center, area.radiusM)],
          },
          style: {
            stroke: [{ color: options.color, width: 2 }],
            fill: options.color,
            fillOpacity: 0.18,
          },
        });
        const dot = container.ownerDocument.createElement("span");
        dot.className = options.dotClass || "";
        dot.setAttribute("aria-hidden", "true");
        const centre = new api.YMapMarker({ coordinates: area.center }, dot);
        instance.addChild(circle);
        instance.addChild(centre);
        shown = [circle, centre];
        if (fit)
          instance.setLocation({
            bounds: circleBounds(area.center, area.radiusM),
            duration: 0,
          });
      },
      center: () => [...(instance.center || options.center)],
      zoom: (delta) => {
        if (!disposed)
          instance.setLocation({
            zoom: Math.min(19, Math.max(3, instance.zoom + delta)),
            duration: 150,
          });
      },
      destroy,
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
