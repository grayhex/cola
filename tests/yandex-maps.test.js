import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createYandexMapsLoader, yandexApiUrl } from "../lib/yandex-maps.js";
import { createYandexRideMap, yandexRoute, yandexGroundLayerId } from "../lib/yandex-ride-map.js";
import { mapDefaults, mapStyle, tileTemplate, isRasterProvider } from "../lib/map-settings.js";

function loaderFixture(timeoutMs = 1000) {
  const win = {};
  const scripts = [];
  const doc = {
    createElement: () => ({ dataset: {}, remove() { this.removed = true; } }),
    head: { appendChild: (script) => scripts.push(script) },
  };
  const load = createYandexMapsLoader({ getWindow: () => win, getDocument: () => doc, timeoutMs });
  return { win, scripts, load };
}
function sdkFixture() {
  const maps = [];
  class Entity {
    constructor(props, element) { this.props = props; this.element = element; }
  }
  class Map {
    constructor(container, props) {
      this.container = container; this.props = props; this.children = [];
      this.destroyed = 0; this.zoom = 10; maps.push(this);
    }
    addChild(entity) { this.children.push(entity); return this; }
    setLocation(location) { this.location = location; }
    destroy() { this.destroyed++; }
  }
  const api = {
    ready: Promise.resolve(), YMap: Map,
    YMapDefaultSchemeLayer: class extends Entity {},
    YMapDefaultFeaturesLayer: class extends Entity {},
    YMapFeature: class extends Entity {}, YMapMarker: class extends Entity {},
    YMapListener: class extends Entity {},
  };
  const container = { ownerDocument: {
    createElement: () => ({ dataset: {}, setAttribute(name, value) { this[name] = value; } }),
  } };
  return { api, maps, container };
}
const geometry = [
  [[37.5, 55.7], [37.51, 55.71]],
  [[37.53, 55.73], [37.55, 55.76]],
];

test("Yandex is not an XYZ provider and never leaks a key to OSM", () => {
  const config = { ...mapDefaults, provider: "yandex", publicKey: "not-a-real-key" };
  assert.equal(isRasterProvider(config), false);
  assert.equal(tileTemplate(config), "");
  assert.equal(mapStyle(config), null);
  assert.equal(tileTemplate(mapDefaults), mapDefaults.tileUrl);
  assert.equal(mapStyle(mapDefaults).sources.basemap.type, "raster");
  assert.equal(mapStyle({ ...mapDefaults, provider: "style", styleUrl: "https://maps.test/style?key={key}", publicKey: "a&b" }), "https://maps.test/style?key=a%26b");
});

test("SDK URL is fixed-origin and encodes the public key", () => {
  const url = new URL(yandexApiUrl(" a&b#c "));
  assert.equal(url.origin, "https://api-maps.yandex.ru");
  assert.equal(url.pathname, "/v3/");
  assert.equal(url.searchParams.get("apikey"), "a&b#c");
  assert.equal(url.searchParams.get("lang"), "ru_RU");
  assert.throws(() => yandexApiUrl(" "), /KEY_MISSING/);
});

test("SDK is browser-only and empty keys never make requests", async () => {
  const load = createYandexMapsLoader({ getWindow: () => undefined, getDocument: () => undefined });
  await assert.rejects(load("test-key"), /BROWSER_ONLY/);
  const f = loaderFixture();
  await assert.rejects(f.load("  "), /KEY_MISSING/);
  assert.equal(f.scripts.length, 0);
});

test("concurrent consumers share one script and wait for SDK readiness", async () => {
  const f = loaderFixture();
  const { api } = sdkFixture();
  let resolveReady;
  api.ready = new Promise((resolve) => { resolveReady = resolve; });
  const one = f.load("test-key"), two = f.load("test-key");
  assert.equal(one, two);
  assert.equal(f.scripts.length, 1);
  assert.equal(f.scripts[0].referrerPolicy, "strict-origin-when-cross-origin");
  f.win.ymaps3 = api;
  let resolved = false;
  one.then(() => { resolved = true; });
  f.scripts[0].onload();
  await Promise.resolve();
  assert.equal(resolved, false);
  resolveReady();
  assert.equal(await one, api);
  assert.equal(await f.load("test-key"), api);
  assert.equal(f.scripts.length, 1);
  await assert.rejects(f.load("changed-key"), /RELOAD_REQUIRED/);
});

test("blocked SDK fails once without retry storms or exposing the key", async () => {
  const f = loaderFixture();
  const result = f.load("test-key");
  const rejected = assert.rejects(result, { message: "YANDEX_MAPS_UNAVAILABLE" });
  f.scripts[0].onerror(new Error("provider returned key in URL"));
  await rejected;
  await assert.rejects(f.load("test-key"), /UNAVAILABLE/);
  assert.equal(f.scripts.length, 1);
  assert.equal(f.scripts[0].removed, true);
});

test("SDK readiness rejection is handled and redacted", async () => {
  const f = loaderFixture();
  const result = f.load("test-key");
  const rejected = assert.rejects(result, { message: "YANDEX_MAPS_UNAVAILABLE" });
  f.win.ymaps3 = { ready: Promise.reject(new Error("invalid key test-key")) };
  f.scripts[0].onload();
  await rejected;
});

test("missing SDK namespace and incompatible SDK fail cleanly", async () => {
  for (const api of [undefined, { ready: Promise.resolve() }]) {
    const f = loaderFixture();
    const result = f.load("test-key");
    const rejected = assert.rejects(result, /UNAVAILABLE/);
    f.win.ymaps3 = api;
    f.scripts[0].onload();
    await rejected;
  }
});

test("SDK connection and readiness waits have a deadline", async () => {
  for (const waitForReady of [false, true]) {
    const f = loaderFixture(5);
    const result = f.load("test-key");
    const rejected = assert.rejects(result, /UNAVAILABLE/);
    if (waitForReady) {
      f.win.ymaps3 = { ready: new Promise(() => {}) };
      f.scripts[0].onload();
    }
    await rejected;
    assert.equal(f.scripts[0].removed, true);
  }
});

test("a foreign global SDK is never silently used with the wrong key", async () => {
  const f = loaderFixture();
  f.win.ymaps3 = sdkFixture().api;
  await assert.rejects(f.load("test-key"), /RELOAD_REQUIRED/);
  assert.equal(f.scripts.length, 0);
});

test("route preserves longitude/latitude order and separate privacy segments", () => {
  const route = yandexRoute(geometry);
  assert.deepEqual(route.segments, geometry);
  assert.deepEqual(route.start, geometry[0][0]);
  assert.deepEqual(route.finish, geometry.at(-1).at(-1));
  assert.ok(route.bounds[0][0] < 37.5 && route.bounds[1][0] > 37.55);
  assert.ok(route.bounds[0][1] < 55.7 && route.bounds[1][1] > 55.76);
  assert.equal(yandexRoute([]), null);
  assert.equal(yandexRoute([[]]), null);
  assert.equal(yandexRoute(null), null);
  assert.equal(yandexRoute([[[37, 55]]]), null);
});

test("invalid points create gaps, metadata is stripped, input is not mutated", () => {
  const input = [[[37, 55, 50], [37.1, 55.1, 80], [NaN, 55], [37.3, 55.3], [37.4, 55.4]]];
  const original = structuredClone(input);
  const route = yandexRoute(input);
  assert.equal(route.segments.length, 2);
  assert.deepEqual(route.segments[0], [[37, 55], [37.1, 55.1]]);
  assert.deepEqual(input, original);
  assert.equal(yandexRoute([[[181, 55], [37, 91]]]), null);
});

test("stationary routes have finite non-zero padded bounds", () => {
  const { bounds } = yandexRoute([[[37.6, 55.7], [37.6, 55.7]]]);
  assert.ok(bounds.flat().every(Number.isFinite));
  assert.ok(bounds[0][0] < bounds[1][0]);
  assert.ok(bounds[0][1] < bounds[1][1]);
});

test("renderer builds separate lines and start/finish markers, not a routing request", () => {
  const { api, maps, container } = sdkFixture();
  const route = yandexRoute(geometry);
  let ready = 0;
  const handle = createYandexRideMap(api, container, route, { onReady: () => ready++ });
  const map = maps[0];
  assert.deepEqual(map.props.location, { bounds: route.bounds });
  assert.equal(map.props.behaviors.includes("scrollZoom"), false);
  const lines = map.children.filter((entity) => entity instanceof api.YMapFeature);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((entity) => entity.props.geometry.coordinates), geometry);
  const markers = map.children.filter((entity) => entity instanceof api.YMapMarker);
  assert.equal(markers.length, 2);
  assert.deepEqual(markers.map((entity) => entity.props.coordinates), [route.start, route.finish]);
  assert.match(markers[0].element.title, /видимой части/);
  const listener = map.children.find((entity) => entity instanceof api.YMapListener);
  listener.props.onStateChanged({ getLayerState: () => ({ tilesReady: 0 }) });
  assert.equal(ready, 0);
  listener.props.onStateChanged({ getLayerState: (id, type, mode) => {
    assert.equal(id, yandexGroundLayerId); assert.equal(type, "tile"); assert.equal(mode, "raster");
    return { tilesReady: 1 };
  } });
  assert.equal(ready, 1);
  handle.zoom(1); assert.equal(map.location.zoom, 11);
  handle.fit(); assert.deepEqual(map.location.bounds, route.bounds);
  handle.destroy(); handle.destroy();
  assert.equal(map.destroyed, 1);
});

test("scroll-zoom is opt-in and rendering timeout destroys the map", async () => {
  const { api, maps, container } = sdkFixture();
  let failed = 0;
  const handle = createYandexRideMap(api, container, yandexRoute(geometry), {
    scrollZoom: true, timeoutMs: 5, onUnavailable: () => failed++,
  });
  assert.ok(maps[0].props.behaviors.includes("scrollZoom"));
  await delay(15);
  assert.equal(failed, 1);
  assert.equal(maps[0].destroyed, 1);
  handle.destroy();
  assert.equal(maps[0].destroyed, 1);
});

test("unmount cancels the render deadline and ignores late SDK events", async () => {
  const { api, maps, container } = sdkFixture();
  let ready = 0, failed = 0;
  const handle = createYandexRideMap(api, container, yandexRoute(geometry), {
    timeoutMs: 5, onReady: () => ready++, onUnavailable: () => failed++,
  });
  const listener = maps[0].children.find((entity) => entity instanceof api.YMapListener);
  handle.destroy();
  listener.props.onStateChanged({ getLayerState: () => ({ tilesReady: 1 }) });
  await delay(15);
  assert.equal(ready, 0); assert.equal(failed, 0);
});

test("initialization failures dispose the partial map", () => {
  const { api, maps, container } = sdkFixture();
  api.YMapFeature = class { constructor() { throw new Error("test failure"); } };
  assert.throws(() => createYandexRideMap(api, container, yandexRoute(geometry)), /test failure/);
  assert.equal(maps[0].destroyed, 1);
});
