// A stand-in for the Yandex Maps JS API v3 (#370): the same constructors the
// site's adapter uses, drawing nothing. It answers what the adapter asks of
// the SDK — a map with a centre and a zoom, children added and removed, a
// listener that hears clicks and tiles — and keeps what was drawn in
// `window.__ymaps`, so a test can see the circle. It proves the site's use of
// the contract, not that the real service behaves so.
export const yandexSdk = `(() => {
  const state = (window.__ymaps = { maps: [], destroyed: 0 });
  class Layer { constructor(props) { this.props = props; } }
  class Feature { constructor(props) { this.props = props; this.feature = true; } }
  class Marker { constructor(props, element) { this.props = props; this.element = element; this.marker = true; } }
  class Listener { constructor(props) { this.props = props; this.listener = true; } }
  class YMap {
    constructor(container, props) {
      this.container = container;
      this.props = props;
      this.children = [];
      const location = props.location || {};
      this.center = location.center || [37.62, 55.75];
      this.zoom = location.zoom || 10;
      this.calls = [];
      state.maps.push(this);
      container.style.background = "#dfe7da";
      container.addEventListener("click", (event) => {
        const box = container.getBoundingClientRect();
        const degrees = 360 / (256 * 2 ** this.zoom);
        const coordinates = [
          this.center[0] + (event.clientX - box.left - box.width / 2) * degrees,
          this.center[1] - (event.clientY - box.top - box.height / 2) * degrees * Math.cos((this.center[1] * Math.PI) / 180),
        ];
        for (const child of this.children)
          if (child.listener && child.props.onClick) child.props.onClick({}, { coordinates, screenCoordinates: [event.clientX, event.clientY] });
      });
      setTimeout(() => {
        for (const child of this.children)
          if (child.listener && child.props.onStateChanged)
            child.props.onStateChanged({ getLayerState: () => ({ tilesReady: 1 }) });
      }, 60);
    }
    addChild(child) { this.children.push(child); }
    removeChild(child) { this.children = this.children.filter((c) => c !== child); }
    setLocation(location) {
      this.calls.push(location);
      if (location.bounds) {
        const [[west, south], [east, north]] = location.bounds;
        this.center = [(west + east) / 2, (south + north) / 2];
      }
      if (location.center) this.center = location.center;
      if (typeof location.zoom === "number") this.zoom = location.zoom;
    }
    destroy() { state.destroyed++; }
  }
  window.ymaps3 = {
    ready: Promise.resolve(),
    YMap,
    YMapDefaultSchemeLayer: Layer,
    YMapDefaultFeaturesLayer: Layer,
    YMapFeature: Feature,
    YMapMarker: Marker,
    YMapListener: Listener,
  };
})();`;
// What the stand-in map draws now: the polygons of its features and the markers.
export const drawn = (page) =>
  page.evaluate(() => {
    const map = window.__ymaps?.maps.at(-1);
    return map
      ? {
          center: map.center,
          zoom: map.zoom,
          polygons: map.children
            .filter((child) => child.feature)
            .map((child) => child.props.geometry.coordinates[0]),
          markers: map.children.filter((child) => child.marker).length,
        }
      : null;
  });
// The latitude span of a ring, in degrees: the size of the circle.
export const span = (ring) => {
  const lats = ring.map(([, lat]) => lat);
  return Math.max(...lats) - Math.min(...lats);
};
