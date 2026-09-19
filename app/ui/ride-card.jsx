"use client";
import dynamic from "next/dynamic";
import { useSite } from "./site-provider.jsx";
import RideBasemap from "./ride-basemap.jsx";
const RideMap = dynamic(() => import("./ride-map.jsx"), { ssr: false });
import { routePaths } from "../../lib/ride-geometry.js";
export function RideRoutePreview({ geometry = [], className = "" }) {
  const paths = routePaths(geometry);
  return (
    <svg
      className={"ride-route " + className}
      viewBox="0 0 640 260"
      role="img"
      aria-label={
        paths.length
          ? "Маршрут покатушки"
          : "Маршрут скрыт настройками приватности"
      }
    >
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {!paths.length && (
        <text x="320" y="130" textAnchor="middle" fill="currentColor">
          Маршрут скрыт
        </text>
      )}
    </svg>
  );
}
export const rideDate = (date) =>
  date
    ? new Date(date).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      })
    : "Дата не указана";
function duration(s) {
  if (s === null || s === undefined) return null;
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}
export function RideMetrics({ metrics: m, compact = false }) {
  return (
    <dl className={"ride-metrics" + (compact ? " compact" : "")}>
      {[
        [
          "Дистанция",
          (m.distanceM / 1000).toLocaleString("ru-RU", {
            maximumFractionDigits: 1,
          }) + " км",
        ],
        ["В движении", duration(m.movingTimeS)],
        [
          "Средняя скорость",
          m.avgSpeedMps == null
            ? null
            : (m.avgSpeedMps * 3.6).toLocaleString("ru-RU", {
                maximumFractionDigits: 1,
              }) + " км/ч",
        ],
        [
          "Набор высоты",
          m.elevationGainM == null ? null : "+" + m.elevationGainM + " м",
        ],
      ]
        .filter(([, v]) => v !== null)
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}
export default function RideCard({ ride: r, owner = false, onEdit }) {
  const { personalSettings: settings } = useSite();
  return (
    <article className="ride-card">
      {settings.rideMapView !== "hidden" &&
        (settings.map?.provider === "style" &&
        settings.rideMapView === "map" ? (
          <RideMap geometry={r.geometry} />
        ) : (
          <RideBasemap geometry={r.geometry} />
        ))}
      <div className="ride-card-body">
        <h3>
          <a href={"/r/" + r.shareId + (owner ? "?owner=1" : "")}>{r.title}</a>
        </h3>
        <p className="help">
          {rideDate(r.date)} ·{" "}
          <a href={"/b/" + r.bike.shareId}>{r.bike.name}</a>
        </p>
        <RideMetrics metrics={r.metrics} compact />
        <div className="ride-social">
          <a href={"/u/" + r.author.username}>@{r.author.username}</a>
          <span>
            ♡ {r.likes} · Комментарии {r.comments}
          </span>
        </div>
        {owner && (
          <div className="ride-actions">
            <span className="help">
              {r.isPublic && r.bikePublic ? "Опубликована" : "Приватная"}
            </span>
            <button className="quiet" onClick={() => onEdit?.(r)}>
              Изменить
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
