"use client";
import RideRsvp, { RecurringRideLabel } from "./ride-rsvp.jsx";
import { CalendarDays, FileSpreadsheet } from "lucide-react";
import {
  defaultRideFields,
  garminFields,
  formatRideMetric,
} from "../../lib/garmin-fields.js";
import { Heart } from "./icons.jsx";
import { useSite } from "./site-provider.jsx";
import RideBasemap from "./ride-basemap.jsx";
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
export function RideMetrics({ metrics: m, compact = false, visibleMetrics }) {
  const keys = visibleMetrics || defaultRideFields;
  return (
    <dl className={"ride-metrics" + (compact ? " compact" : "")}>
      {keys.map((key) => {
        const f = garminFields.find((f) => f.key === key);
        const value = f ? formatRideMetric(m[key], f.format) : null;
        return value === null ? null : (
          <div key={key}>
            <dt>{f.label}</dt>
            <dd>{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
export default function RideCard({ ride: r, owner = false, onEdit }) {
  const { personalSettings: settings } = useSite();
  return (
    <article className="ride-card">
      {settings.rideMapView !== "hidden" && r.geometry?.length > 0 && (
        <RideBasemap geometry={r.geometry} thumbnail />
      )}
      <div className="ride-card-body">
        {r.status !== "completed" && (
          <span className="ride-status">
            <CalendarDays size={14} />
            {r.status === "cancelled" ? "Отменена" : "Планируемая покатушка"}
          </span>
        )}
        {r.sourceKind === "garmin" && !r.hasTrack && (
          <span className="ride-status">
            <FileSpreadsheet size={14} />
            Garmin · без трека
          </span>
        )}
        <h3>
          <a href={"/r/" + r.shareId + (owner ? "?owner=1" : "")}>{r.title}</a>
        </h3>
        <p className="help">
          {rideDate(r.date)} ·{" "}
          <a href={"/b/" + r.bike.shareId}>{r.bike.name}</a>
        </p>
        <RecurringRideLabel ride={r} />
        <RideRsvp ride={r} />
        <RideMetrics
          metrics={r.metrics}
          visibleMetrics={r.visibleMetrics}
          compact
        />
        <div className="ride-social">
          <a href={"/u/" + r.author.username}>@{r.author.username}</a>
          <span>
            <Heart size={12} aria-label="Лайки" /> {r.likes} · Комментарии{" "}
            {r.comments}
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
