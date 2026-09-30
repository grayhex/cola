"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import RideBasemap, { MapAttribution } from "./ride-basemap.tsx";
import YandexRideMap from "./yandex-ride-map.tsx";
import { useSite } from "./site-provider.tsx";
import { mapDefaults, mapStyle } from "../../lib/map-settings.ts";
import { bounds } from "../../lib/ride-geometry.ts";
import { routeCasing } from "../../lib/yandex-ride-map.ts";
export default function RideMap({
  geometry,
  styleUrl,
  transitionId,
  selectedCoord,
}) {
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
  return (
    <MapLibreRideMap
      geometry={geometry}
      styleUrl={styleUrl}
      transitionId={transitionId}
      selectedCoord={selectedCoord}
    />
  );
}
function MapLibreRideMap({ geometry, styleUrl, transitionId, selectedCoord }) {
  const { personalSettings: settings } = useSite();
  const config = settings.map || mapDefaults;
  // Raster providers produce an object: keep it stable through ready/visible
  // renders so that the map effect does not recreate its own canvas (#140).
  const style = useMemo(() => styleUrl || mapStyle(config), [styleUrl, config]);
  const markerRef = useRef(null),
    selectedRef = useRef(selectedCoord);
  useEffect(() => {
    selectedRef.current = selectedCoord;
    updateMarker(markerRef.current, selectedCoord);
  }, [selectedCoord]);
  const ref = useRef(null),
    [ready, setReady] = useState(false),
    [visible, setVisible] = useState(false);
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
              geometry: {
                type: "MultiLineString",
                coordinates: geometry.filter((run) => run.length > 1),
              },
            },
          });
          // A dark casing under the accent line keeps the route visible
          // over yellow and orange roads of the basemap (#131).
          map.addLayer({
            id: "ride-casing",
            type: "line",
            source: "ride",
            paint: {
              "line-color": routeCasing,
              "line-width": 7,
              "line-opacity": 0.75,
            },
            layout: { "line-join": "round", "line-cap": "round" },
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
          const dot = document.createElement("div");
          dot.className = "ride-analysis-marker";
          dot.setAttribute("role", "img");
          dot.setAttribute("aria-label", "Выбранная точка маршрута");
          markerRef.current = new lib.Marker({ element: dot })
            .setLngLat(selectedRef.current || geometry[0][0])
            .addTo(map);
          updateMarker(markerRef.current, selectedRef.current);
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
      markerRef.current?.remove();
      markerRef.current = null;
      map?.remove();
    };
  }, [
    geometry,
    style,
    config,
    settings.rideMapView,
    settings.mapScrollZoom,
    visible,
  ]);
  if (settings.rideMapView === "hidden") return null;
  return (
    <div className="ride-map-wrap">
      <div
        className={"ride-map map-engine" + (ready ? " ready" : "")}
        ref={ref}
        aria-label="Интерактивная карта маршрута"
      />
      {ready && <MapAttribution config={config} />}
      {!ready && (
        <RideBasemap
          geometry={geometry}
          transitionId={transitionId}
          selectedCoord={selectedCoord}
        />
      )}
    </div>
  );
}

function updateMarker(marker, coord) {
  if (!marker) return;
  const element = marker.getElement();
  element.hidden = !coord;
  if (coord) {
    marker.setLngLat(coord);
    element.dataset.coordinate = coord.join(",");
  }
}
