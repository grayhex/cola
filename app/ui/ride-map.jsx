"use client";
import { useEffect, useRef, useState } from "react";
import RideBasemap, { MapAttribution } from "./ride-basemap.jsx";
import YandexRideMap from "./yandex-ride-map.jsx";
import { useSite } from "./site-provider.jsx";
import { mapDefaults, mapStyle } from "../../lib/map-settings.js";
import { bounds } from "../../lib/ride-geometry.js";
export default function RideMap({ geometry, styleUrl }) {
  const { personalSettings: settings } = useSite();
  const config = settings.map || mapDefaults;
  if (settings.rideMapView === "hidden") return null;
  if (config.provider === "yandex") {
    return (
      <YandexRideMap
        geometry={geometry}
        config={config}
        view={settings.rideMapView || "map"}
        scrollZoom={!!settings.mapScrollZoom}
      />
    );
  }
  return <MapLibreRideMap geometry={geometry} styleUrl={styleUrl} />;
}
function MapLibreRideMap({ geometry, styleUrl }) {
  const { personalSettings: settings } = useSite();
  const config = settings.map || mapDefaults;
  const style = styleUrl || mapStyle(config);
  const ref = useRef(null),
    [ready, setReady] = useState(false),
    [visible, setVisible] = useState(false);
  // MapLibre paints outside CSS: read the theme tokens it needs.
  const token = (name) =>
    getComputedStyle(ref.current).getPropertyValue(name).trim() ||
    { "--accent": "#C2410C", "--success": "#1E8A5A" }[name];
  useEffect(() => {
    // Lazy-load once. Scrolling to the chart must not destroy the map and
    // replace it with a differently sized preview underneath the pointer.
    const observer = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let map,
      disposed = false;
    setReady(false);
    if (
      !visible ||
      !style ||
      !geometry.length ||
      settings.rideMapView !== "map" ||
      !config.enabled
    )
      return;
    import("maplibre-gl")
      .then((lib) => {
        if (disposed) return;
        lib.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
        map = new lib.Map({
          container: ref.current,
          style,
          attributionControl: true,
        });
        if (!settings.mapScrollZoom) map.scrollZoom.disable();
        map.on("error", () => {
          if (!disposed) setReady(false);
        });
        map.on("load", () => {
          if (disposed) return;
          map.addSource("ride", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "MultiLineString", coordinates: geometry },
            },
          });
          map.addLayer({
            id: "ride",
            type: "line",
            source: "ride",
            paint: {
              "line-color": token("--accent"),
              "line-width": 4,
            },
            layout: { "line-join": "round", "line-cap": "round" },
          });
          const b = bounds(geometry);
          map.fitBounds(
            [
              [b[0], b[1]],
              [b[2], b[3]],
            ],
            { padding: 36, maxZoom: 15, duration: 0 },
          );
          for (const [point, color] of [
            [geometry[0][0], token("--success")],
            [geometry.at(-1).at(-1), token("--accent")],
          ])
            new lib.Marker({ color }).setLngLat(point).addTo(map);
          map.addControl(new lib.NavigationControl());
          map.once("idle", () => {
            if (!disposed) setReady(true);
          });
        });
      })
      .catch(() => {});
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [
    geometry,
    styleUrl,
    config,
    settings.rideMapView,
    settings.mapScrollZoom,
    visible,
  ]);
  if (settings.rideMapView === "hidden") return null;
  return (
    <div className="ride-map-wrap">
      <div
        className={"ride-map" + (ready ? " ready" : "")}
        ref={ref}
        aria-label="Интерактивная карта маршрута"
      />
      {ready && <MapAttribution config={config} />}
      {!ready && <RideBasemap geometry={geometry} />}
    </div>
  );
}
