"use client";
import { useEffect, useRef, useState } from "react";
import {
  rasterViewport,
  tileTemplate,
  mapDefaults,
  osmAttribution,
} from "../../lib/map-settings.js";
import { useSite } from "./site-provider.jsx";
export function MapAttribution({ config }) {
  return (
    <div className="ride-map-attribution">
      <a href={osmAttribution} target="_blank" rel="noopener">
        © OpenStreetMap contributors
      </a>
      {config.provider !== "osm" && config.attribution && (
        <span> · {config.attribution}</span>
      )}
    </div>
  );
}
export default function RideBasemap({ geometry = [], forceRoute = false }) {
  const { personalSettings: settings } = useSite(),
    config = settings.map || mapDefaults;
  const ref = useRef(null),
    [visible, setVisible] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([e]) =>
      setVisible(e.isIntersecting),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const template = tileTemplate(config);
  useEffect(() => setFailed(false), [template, geometry]);
  const viewport = rasterViewport(geometry),
    showTiles =
      !forceRoute &&
      config.enabled &&
      config.provider !== "style" &&
      settings.rideMapView !== "route";
  return (
    <div ref={ref} className="ride-basemap">
      <svg
        className="ride-route"
        viewBox="0 0 640 260"
        role="img"
        aria-label={
          geometry.length
            ? "Карта маршрута покатушки"
            : "Маршрут скрыт настройками приватности"
        }
      >
        {visible &&
          showTiles &&
          viewport?.tiles.map((t) => (
            <image
              key={t.z + ":" + t.x + ":" + t.y}
              x={t.left}
              y={t.top}
              width="256"
              height="256"
              href={template
                .replaceAll("{z}", t.z)
                .replaceAll("{x}", t.x)
                .replaceAll("{y}", t.y)}
              onError={() => setFailed(true)}
            />
          ))}
        {viewport?.paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {!viewport && (
          <text x="320" y="130" textAnchor="middle" fill="currentColor">
            Маршрут скрыт
          </text>
        )}
      </svg>
      {showTiles && viewport && <MapAttribution config={config} />}
      {failed && (
        <small className="help map-status">
          Подложка недоступна · показана линия маршрута
        </small>
      )}
    </div>
  );
}
