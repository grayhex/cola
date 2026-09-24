"use client";
import Link from "next/link";
import { useState } from "react";
import Photo from "./bike-photo.jsx";
import { Plus, Search, X, ArrowRight, ArrowDown } from "./icons.jsx";
import { specRows } from "../../lib/garage-layout.js";
import { routePaths } from "../../lib/ride-geometry.js";
import { publicPath } from "../../lib/public-urls.js";
import styles from "./bike-page.module.css";
const number = (value, digits = 0) =>
  Number(value).toLocaleString("ru-RU", { maximumFractionDigits: digits });
// Big photo with "1 / N", then a strip of thumbnails; the active one has an
// accent outline. Visitors see five tiles at most, owners every photo with
// its cover and delete actions.
export function BikeGallery({
  bike,
  photo,
  onSelect,
  onOpen,
  editable,
  busy,
  onUpload,
  onSearch,
  onCover,
  onDelete,
  demoCredit = false,
  t,
}) {
  const [all, setAll] = useState(false);
  const photos = bike.photos,
    current = photo || photos[0],
    index = Math.max(
      0,
      photos.findIndex((p) => p.id === current?.id),
    ),
    shown = editable || all || photos.length <= 5 ? photos : photos.slice(0, 4),
    source = current?.source_page_url;
  return (
    <div className={styles.gallery}>
      <div className={styles.stage}>
        <button
          type="button"
          className="photo-open"
          aria-label={t("Открыть фото целиком")}
          onClick={onOpen}
        >
          <Photo
            bike={bike}
            photo={photo}
            className="hero-photo"
            sizes="(max-width: 1023px) 100vw, 55vw"
            priority
          />
        </button>
        {photos.length > 1 && (
          <span className={styles.index}>
            {index + 1} / {photos.length}
          </span>
        )}
        {editable && (
          <div className={styles.tools}>
            <button
              type="button"
              className="icon"
              disabled={busy}
              aria-label="Загрузить фото"
              onClick={onUpload}
            >
              <Plus size={18} />
            </button>
            <button
              type="button"
              className="icon"
              aria-label="Найти фотографии"
              onClick={onSearch}
            >
              <Search size={18} />
            </button>
          </div>
        )}
        {source && (
          <a
            className={styles.credit}
            href={source}
            target="_blank"
            rel="noreferrer"
          >
            Источник фотографии
          </a>
        )}
        {demoCredit && (
          <a
            className={styles.credit}
            href="https://www.canyon.com/en-si/outlet-bikes/gravel-bikes/grizl-al-7-raw/50051247.html"
            target="_blank"
            rel="noreferrer"
          >
            {t("Фото: Canyon · пример сборки")}
          </a>
        )}
      </div>
      {(photos.length > 1 || (editable && photos.length > 0)) && (
        <ul className={styles.thumbs} aria-label="Фотографии">
          {shown.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={styles.thumb}
                aria-label={t("Показать фотографию")}
                aria-pressed={current?.id === p.id}
                onClick={() => onSelect(p)}
              >
                <Photo bike={bike} photo={p} sizes="160px" />
              </button>
              {editable && (
                <div className={styles.thumbTools}>
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy || p.is_cover}
                    onClick={() => onCover(p)}
                  >
                    {p.is_cover ? t("Обложка") : t("На обложку")}
                  </button>
                  <button
                    type="button"
                    className="icon"
                    aria-label={t("Удалить фото")}
                    onClick={() => onDelete(p)}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </li>
          ))}
          {shown.length < photos.length && (
            <li>
              <button
                type="button"
                className={`${styles.thumb} ${styles.more}`}
                aria-label={`Показать ещё ${photos.length - shown.length} фото`}
                onClick={() => setAll(true)}
              >
                +{photos.length - shown.length}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
// Weight, mileage and rides, then the key parts: only what has data.
export function BikeFacts({ bike, settings, catalog, rides, experience }) {
  const tiles = [
    Number(bike.weight) > 0 && ["Вес", number(bike.weight, 2) + " кг"],
    settings.showMileage &&
      Number(bike.mileage) > 0 && ["Пробег", number(bike.mileage) + " км"],
    rides?.total > 0 && ["Покатушек", number(rides.total)],
  ].filter(Boolean);
  const rows = [
    bike.size && { category: "Размер", name: bike.size },
    bike.color && { category: "Цвет", name: bike.color },
    ...specRows(bike.components, catalog.componentGroups),
  ].filter(Boolean);
  const parts = bike.components.filter((c) => c.section === "build").length;
  return (
    <>
      {tiles.length > 0 && (
        <dl className={styles.tiles}>
          {tiles.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {rows.length > 0 && (
        <dl className={styles.specs} aria-label="Комплектация кратко">
          {rows.map((row) => (
            <div key={row.category}>
              <dt>{row.category}</dt>
              <dd>{row.name}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className={styles.links}>
        {parts > 0 && (
          <a href="#specifications">
            Вся комплектация · {parts}{" "}
            <ArrowDown size={15} aria-hidden="true" />
          </a>
        )}
        {experience && (
          <Link href={experience} title="Опыт владельцев этой модели">
            Опыт владельцев модели <ArrowRight size={15} aria-hidden="true" />
          </Link>
        )}
      </div>
    </>
  );
}
const duration = (seconds) => {
  const minutes = Math.round(seconds / 60);
  return Math.floor(minutes / 60) + ":" + String(minutes % 60).padStart(2, "0");
};
// The newest completed ride of this bike: route, distance, climb and time.
export function LatestRide({ rides }) {
  const ride = rides?.rides.find((r) => r.status === "completed");
  if (!ride) return null;
  const paths = routePaths(ride.geometry || [], 300, 120, 12),
    point = (d, last) => {
      const numbers = d.match(/-?[\d.]+/g).map(Number);
      return last ? numbers.slice(-2) : numbers.slice(0, 2);
    },
    m = ride.metrics || {};
  const metrics = [
    m.distanceM != null && ["Дистанция", number(m.distanceM / 1000, 1) + " км"],
    m.elevationGainM != null && ["Набор", number(m.elevationGainM) + " м"],
    (m.movingTimeS || m.elapsedTimeS) && [
      "Время",
      duration(m.movingTimeS || m.elapsedTimeS),
    ],
  ].filter(Boolean);
  return (
    <section className={styles.latest} aria-labelledby="latest-ride">
      <div className={styles.latestHead}>
        <h2 id="latest-ride">Последняя покатушка</h2>
        <a href="#rides">
          Все <ArrowRight size={15} aria-hidden="true" />
        </a>
      </div>
      <Link className={styles.route} href={publicPath("ride", ride)}>
        {paths.length ? (
          <svg viewBox="0 0 300 120" role="img" aria-label="Маршрут покатушки">
            {paths.map((d, i) => (
              <path key={i} d={d} />
            ))}
            <circle
              className={styles.start}
              r="6"
              cx={point(paths[0])[0]}
              cy={point(paths[0])[1]}
            />
            <circle
              className={styles.finish}
              r="6"
              cx={point(paths.at(-1), true)[0]}
              cy={point(paths.at(-1), true)[1]}
            />
          </svg>
        ) : null}
        <span className={styles.rideTitle}>{ride.title}</span>
      </Link>
      {metrics.length > 0 && (
        <dl className={styles.metrics}>
          {metrics.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
