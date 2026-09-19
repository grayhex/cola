"use client";
import { useEffect, useRef, useState } from "react";
import RideBasemap, { MapAttribution } from "./ride-basemap.jsx";
import { useSite } from "./site-provider.jsx";
import { mapDefaults, mapStyle } from "../../lib/map-settings.js";
import { bounds } from "../../lib/ride-geometry.js";
export default function RideMap({ geometry, styleUrl }) {
  const { personalSettings: settings } = useSite();
  const config = settings.map || mapDefaults;
  const style = styleUrl || mapStyle(config);
  const ref = useRef(null),
    [ready, setReady] = useState(false),
    [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([e]) =>
      setVisible(e.isIntersecting),
    );
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
              "line-color":
                getComputedStyle(ref.current)
                  .getPropertyValue("--accent")
                  .trim() || "#e7482f",
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
            [geometry[0][0], "#237d50"],
            [geometry.at(-1).at(-1), "#e7482f"],
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
