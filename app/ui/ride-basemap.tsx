"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SharedView } from "./motion.tsx";
import {
  rasterViewport,
  tileTemplate,
  isRasterProvider,
  mapDefaults,
  osmAttribution,
} from "../../lib/map-settings.ts";
import { useSite } from "./site-provider.tsx";
export function MapAttribution({ config }) {
  // The Yandex SDK renders its own mandatory attribution; route-only previews
  // must not claim that an OSM basemap is being displayed.
  if (config.provider === "yandex") return null;
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
export default function RideBasemap({
  geometry = [],
  forceRoute = false,
  thumbnail = false,
  transitionId,
  href,
  selectedCoord,
}) {
  const { personalSettings: settings } = useSite(),
    config = thumbnail
      ? { ...mapDefaults, enabled: settings.map?.enabled !== false }
      : settings.map || mapDefaults;
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
  const viewport = useMemo(() => rasterViewport(geometry), [geometry]),
    cursor = selectedCoord && viewport?.point(selectedCoord),
    showTiles =
      !forceRoute &&
      config.enabled &&
      isRasterProvider(config) &&
      settings.rideMapView !== "route" &&
      settings.rideMapView !== "hidden";
  const preview = (
    <SharedView kind="ride-map" id={transitionId}>
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
          !failed &&
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
            key={"casing" + i}
            className="route-casing"
            d={d}
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
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
        {cursor && (
          <circle
            role="img"
            aria-label="Выбранная точка маршрута"
            cx={cursor[0]}
            cy={cursor[1]}
            r="6"
            fill="#ffffff"
            stroke="#1d2733"
            strokeWidth="3"
          />
        )}
        {!viewport && (
          <text x="320" y="130" textAnchor="middle" fill="currentColor">
            Маршрут скрыт
          </text>
        )}
      </svg>
    </SharedView>
  );
  return (
    <div ref={ref} className="ride-basemap">
      {href ? (
        <Link
          href={href}
          className="ride-preview-link"
          aria-label="Открыть покатушку по карте"
        >
          {preview}
        </Link>
      ) : (
        preview
      )}
      {showTiles && viewport && <MapAttribution config={config} />}
      {failed && (
        <small className="help map-status">
          Подложка недоступна · показана линия маршрута
        </small>
      )}
    </div>
  );
}
