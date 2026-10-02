"use client";
import type { RideItem } from "./ride-types.ts";
import type { RideMetrics as RideMetricsData } from "../../lib/ride-metrics.ts";
import Link from "next/link";
import RidePassport from "./ride-passport.tsx";
import { SharedView } from "./motion.tsx";
import RideRsvp, { RecurringRideLabel } from "./ride-rsvp.tsx";
import { CalendarDays, FileSpreadsheet } from "lucide-react";
import {
  defaultRideFields,
  garminFields,
  formatRideMetric,
} from "../../lib/garmin-fields.ts";
import { Heart, Mountain, Route, Timer } from "./icons.tsx";
import { useSite } from "./site-provider.tsx";
import RideBasemap from "./ride-basemap.tsx";
import { routePaths } from "../../lib/ride-geometry.ts";
import { profilePath, publicPath } from "../../lib/public-urls.ts";
import { personName } from "../../lib/usernames.ts";
export function RideRoutePreview({
  geometry = [],
  className = "",
  width = 640,
  height = 260,
}: {
  geometry?: number[][][];
  className?: string;
  width?: number;
  height?: number;
}) {
  const paths = routePaths(geometry, width, height);
  return (
    <svg
      className={"ride-route " + className}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={
        paths.length
          ? "Маршрут покатушки"
          : "Маршрут скрыт настройками приватности"
      }
    >
      {paths.map((d, i) => (
        <path
          key={"casing" + i}
          className="route-casing"
          d={d}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
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
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          fill="currentColor"
        >
          Маршрут скрыт
        </text>
      )}
    </svg>
  );
}
export const rideDate = (date: string | null | undefined) =>
  date
    ? new Date(date).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      })
    : "Дата не указана";
export function RideMetrics({
  metrics: m,
  compact = false,
  visibleMetrics,
}: {
  metrics: Omit<RideMetricsData, "distanceM"> & { distanceM?: number | null };
  compact?: boolean;
  visibleMetrics?: string[] | null;
}) {
  const keys = visibleMetrics || defaultRideFields;
  return (
    <dl className={"ride-metrics" + (compact ? " compact" : "")}>
      {keys.map((key) => {
        const f = garminFields.find((f) => f.key === key);
        const value = f ? formatRideMetric(m[key], f.format) : null;
        return value === null ? null : (
          <div key={key}>
            <dt>{f?.label}</dt>
            <dd>{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
const kilometres = (meters: number) =>
  (meters / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " км";
function duration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  return hours
    ? `${hours} ч${minutes % 60 ? ` ${minutes % 60} мин` : ""}`
    : `${minutes} мин`;
}
// A ride in the row of the bike page (#291): the route as a small picture,
// the title and the date, and the figures the track really has. It never
// draws a picture or a pace the ride does not carry.
export function RideCompactCard({ ride: r }: { ride: RideItem }) {
  const { personalSettings: settings } = useSite();
  const href = publicPath("ride", r);
  const m = r.metrics;
  const time = m.movingTimeS ?? m.elapsedTimeS;
  const facts = [
    m.distanceM
      ? { key: "distance", Icon: Route, text: kilometres(Number(m.distanceM)) }
      : null,
    time ? { key: "time", Icon: Timer, text: duration(Number(time)) } : null,
    m.elevationGainM
      ? {
          key: "climb",
          Icon: Mountain,
          text:
            "+" +
            Math.round(Number(m.elevationGainM)).toLocaleString("ru-RU") +
            " м",
        }
      : null,
  ].filter((fact) => fact !== null);
  const route = settings.rideMapView !== "hidden" && r.geometry?.length > 0;
  return (
    <article className="ride-compact">
      <Link
        className="ride-compact-thumb"
        href={href}
        tabIndex={-1}
        aria-hidden="true"
      >
        {route ? (
          <RideRoutePreview geometry={r.geometry} width={120} height={120} />
        ) : (
          <Route size={28} strokeWidth={1.5} />
        )}
      </Link>
      <div className="ride-compact-body">
        {r.status !== "completed" && (
          <span className="ride-status">
            <CalendarDays size={14} aria-hidden="true" />
            {r.status === "cancelled" ? "Отменена" : "Планируемая покатушка"}
          </span>
        )}
        <h3>
          <Link href={href}>{r.title}</Link>
        </h3>
        <p className="help">{rideDate(r.date)}</p>
        {facts.length > 0 && (
          <ul className="ride-compact-facts" aria-label="Показатели поездки">
            {facts.map(({ key, Icon, text }) => (
              <li key={key}>
                <Icon size={14} aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
/**/
export default function RideCard({
  ride: r,
  owner = false,
  onEdit,
}: {
  ride: RideItem;
  owner?: boolean;
  onEdit?: (ride: RideItem) => void;
}) {
  const { personalSettings: settings } = useSite();
  const href = publicPath("ride", r) + (owner ? "?owner=1" : "");
  return (
    <article className="ride-card">
      {settings.rideMapView !== "hidden" && r.geometry?.length > 0 && (
        <RideBasemap
          geometry={r.geometry}
          thumbnail
          transitionId={r.id}
          href={href}
        />
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
        <SharedView kind="ride-title" id={r.id}>
          <h3>
            <Link href={href}>{r.title}</Link>
          </h3>
        </SharedView>
        <p className="help">
          {rideDate(r.date)} ·{" "}
          <a href={publicPath("bike", r.bike)}>{r.bike.name}</a>
        </p>
        <RecurringRideLabel ride={r} />
        {r.status === "planned" &&
          (r.participation === "reconfirm" || r.recruitmentClosed) && (
            <p className="ride-card-flags">
              {r.participation === "reconfirm" && (
                <span className="badge" data-tone="warning">
                  Условия изменились — подтвердите заново
                </span>
              )}
              {r.recruitmentClosed && (
                <span className="badge">Набор закрыт</span>
              )}
            </p>
          )}
        <RideRsvp ride={r} compact />
        {r.sourceKind === "planned" && (
          <RidePassport passport={r.passport} compact />
        )}
        <RideMetrics
          metrics={r.metrics}
          visibleMetrics={r.visibleMetrics}
          compact
        />
        <div className="ride-social">
          <a href={profilePath(r.author.username)}>{personName(r.author)}</a>
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
