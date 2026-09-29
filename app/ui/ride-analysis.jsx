"use client";
import { useMemo, useState } from "react";
import { analysisChannels } from "../../lib/ride-analysis-contract.js";
import styles from "./ride-analysis.module.css";

const labels = {
  elevationM: ["Высота", "м", 1],
  speedMps: ["Скорость", "км/ч", 3.6],
  gradePct: ["Уклон", "%", 1],
  hrBpm: ["Пульс", "уд/мин", 1],
  cadenceRpm: ["Каденс", "об/мин", 1],
  powerW: ["Мощность", "Вт", 1],
};
const value = (p, key) =>
  p?.[key] == null ? "—" : (p[key] * labels[key][2]).toFixed(1);
const elapsed = (seconds) =>
  seconds == null
    ? "—"
    : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function RideAnalysis({ series, selected, onSelect }) {
  const [page, setPage] = useState(0);
  const points = useMemo(() => series.segments.flat(), [series]);
  const channels = useMemo(
    () => [
      "elevationM",
      "speedMps",
      ...series.channels.filter((k) => k !== "elevationM" && k !== "speedMps"),
    ],
    [series],
  );
  const distance = points.at(-1)?.distanceM || 1;
  const active = points[Math.min(selected, points.length - 1)];
  const x = (p) => 48 + (p.distanceM / distance) * 696;
  const charts = useMemo(
    () =>
      channels.map((key) => {
        const present = points.filter((p) => p[key] != null);
        const min = present.length
          ? Math.min(...present.map((p) => p[key]))
          : 0;
        const max = present.length
          ? Math.max(...present.map((p) => p[key]))
          : 1;
        const y = (p) => 104 - ((p[key] - min) / (max - min || 1)) * 80;
        const bit = 1 << analysisChannels.indexOf(key);
        const path = series.segments
          .map((run) => {
            let connected = false;
            return run
              .map((p) => {
                if (p[key] == null) {
                  connected = false;
                  return "";
                }
                const command = connected && !(p.gaps & bit) ? "L" : "M";
                connected = true;
                return `${command}${(48 + (p.distanceM / distance) * 696).toFixed(2)},${y(p).toFixed(2)}`;
              })
              .join(" ");
          })
          .join(" ");
        return { key, path, min, max, y, present: present.length > 0 };
      }),
    [channels, points, series, distance],
  );
  function scrub(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const target =
      Math.max(
        0,
        Math.min(
          1,
          (((event.clientX - rect.left) / rect.width) * 768 - 48) / 696,
        ),
      ) * distance;
    let nearest = 0;
    for (let i = 1; i < points.length; i++)
      if (
        Math.abs(points[i].distanceM - target) <
        Math.abs(points[nearest].distanceM - target)
      )
        nearest = i;
    onSelect(nearest);
  }
  return (
    <section className={styles.analysis} aria-label="Анализ поездки">
      <h2>Анализ поездки</h2>
      <p className="help">
        {series.visibility === "owner"
          ? "Полный трек · виден только вам"
          : "Публичная часть трека"}
        . Высота сглажена медианой пяти точек; скорость и уклон рассчитаны по
        GPS. Пропуски не соединяются. Итоги поездки не изменены.
      </p>
      {series.downsampled && (
        <p className="help">
          Показаны {series.pointCount} из {series.sourcePointCount} точек.
          Короткие пики могут быть пропущены.
        </p>
      )}
      {!points.length ? (
        <p>Нет доступных точек: маршрут скрыт настройками приватности.</p>
      ) : (
        <>
          <label className={styles.selector}>
            Точка маршрута
            <input
              type="range"
              min="0"
              max={points.length - 1}
              value={Math.min(selected, points.length - 1)}
              onChange={(e) => onSelect(Number(e.target.value))}
              aria-valuetext={`${(active.distanceM / 1000).toFixed(2)} км, ${elapsed(active.elapsedS)}`}
            />
          </label>
          <div className={styles.readout} aria-live="polite" aria-atomic="true">
            <strong>
              {(active.distanceM / 1000).toFixed(2)} км ·{" "}
              {elapsed(active.elapsedS)}
            </strong>
            <span>
              {channels
                .map(
                  (key) =>
                    `${labels[key][0]}: ${value(active, key)} ${labels[key][1]}`,
                )
                .join(" · ")}
            </span>
          </div>
          {charts.map(({ key, path, min, max, y, present }) => (
            <div className={styles.chart} key={key}>
              <h3>
                {labels[key][0]} <small>{labels[key][1]}</small>
              </h3>
              {present ? (
                <svg
                  viewBox="0 0 768 136"
                  role="img"
                  aria-label={`График: ${labels[key][0]} по расстоянию`}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    scrub(e);
                  }}
                  onPointerMove={(e) => {
                    if (e.pointerType === "mouse" || e.buttons) scrub(e);
                  }}
                >
                  <line
                    x1="48"
                    x2="744"
                    y1="104"
                    y2="104"
                    className={styles.grid}
                  />
                  <text x="4" y="30">
                    {(max * labels[key][2]).toFixed(0)}
                  </text>
                  <text x="4" y="104">
                    {(min * labels[key][2]).toFixed(0)}
                  </text>
                  <text x="48" y="130">
                    0 км
                  </text>
                  <text x="744" y="130" textAnchor="end">
                    {(distance / 1000).toFixed(2)} км
                  </text>
                  <path d={path} className={styles.line} />
                  <line
                    x1={x(active)}
                    x2={x(active)}
                    y1="18"
                    y2="104"
                    className={styles.cursor}
                  />
                  {active[key] != null && (
                    <circle
                      cx={x(active)}
                      cy={y(active)}
                      r="4"
                      fill="var(--chart-line)"
                    />
                  )}
                </svg>
              ) : (
                <p className="help">
                  Нет данных:{" "}
                  {key === "speedMps"
                    ? "в треке нет корректных временных интервалов"
                    : "в треке нет высоты"}
                  .
                </p>
              )}
            </div>
          ))}
          <details className={styles.data}>
            <summary>Таблица значений</summary>
            <div>
              <table>
                <caption>Телеметрия поездки · страница {page + 1}</caption>
                <thead>
                  <tr>
                    <th>Точка</th>
                    <th>км</th>
                    <th>Время</th>
                    {channels.map((key) => (
                      <th key={key}>
                        {labels[key][0]}, {labels[key][1]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {points.slice(page * 50, (page + 1) * 50).map((p, i) => (
                    <tr
                      key={page * 50 + i}
                      aria-selected={page * 50 + i === selected}
                    >
                      <td>
                        <button
                          className="quiet"
                          onClick={() => onSelect(page * 50 + i)}
                          aria-label={`Выбрать точку ${page * 50 + i + 1}`}
                        >
                          {page * 50 + i + 1}
                        </button>
                      </td>
                      <td>{(p.distanceM / 1000).toFixed(2)}</td>
                      <td>{elapsed(p.elapsedS)}</td>
                      {channels.map((key) => (
                        <td key={key}>{value(p, key)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav aria-label="Страницы телеметрии">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Назад
              </button>
              <span>
                {page + 1} / {Math.ceil(points.length / 50)}
              </span>
              <button
                disabled={(page + 1) * 50 >= points.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Далее
              </button>
            </nav>
          </details>
        </>
      )}
    </section>
  );
}
