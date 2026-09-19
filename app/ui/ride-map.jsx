"use client";
import { useEffect, useRef, useState } from "react";
import { RideRoutePreview } from "./ride-card.jsx";
import { bounds } from "../../lib/ride-geometry.js";
export default function RideMap({ geometry, styleUrl }) {
  const ref = useRef(null),
    [ready, setReady] = useState(false);
  useEffect(() => {
    let map,
      disposed = false;
    setReady(false);
    if (!styleUrl || !geometry.length) return;
    import("maplibre-gl")
      .then(({ default: lib }) => {
        if (disposed) return;
        map = new lib.Map({
          container: ref.current,
          style: styleUrl,
          attributionControl: true,
        });
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
          setReady(true);
        });
      })
      .catch(() => {});
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [geometry, styleUrl]);
  return (
    <div className="ride-map-wrap">
      <div
        className={"ride-map" + (ready ? " ready" : "")}
        ref={ref}
        aria-label="Интерактивная карта маршрута"
      />
      {!ready && <RideRoutePreview geometry={geometry} />}
    </div>
  );
}
