"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Gauge } from "./icons.jsx";
import styles from "./ride-speed-chart.module.css";

export default function RideSpeedChart({ profile = [] }) {
  const id = useId().replaceAll(":", "");
  const points = profile.flat();
  const hasPoints = points.length > 0;
  const svgRef = useRef(null);
  const [width, setWidth] = useState(800);
  const [selected, setSelected] = useState(null);
  const [ready, setReady] = useState(false);
  // Keep axis labels and plot height readable instead of shrinking an 800px
  // illustration down to phone width.
  useEffect(() => {
    if (!hasPoints || !svgRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(240, Math.round(entry.contentRect.width)));
      setReady(true);
    });
    observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, [hasPoints]);
  const plotWidth = width - 84;
  const maxSpeed = Math.max(
    10,
    Math.ceil(Math.max(...points.map((p) => p.speedKmh), 0) / 10) * 10,
  );
  const maxDistance = Math.max(...points.map((p) => p.distanceKm), 0.001);
  const x = (p) => 42 + (p.distanceKm / maxDistance) * plotWidth;
  const y = (p) => 160 - (p.speedKmh / maxSpeed) * 136;
  const active =
    selected === null ? null : points[Math.min(selected, points.length - 1)];
  const format = (value) =>
    value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  function selectPoint(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const km =
      ((((event.clientX - rect.left) / rect.width) * width - 42) / plotWidth) *
      maxDistance;
    setSelected(
      points.reduce(
        (best, p, i) =>
          Math.abs(p.distanceKm - km) < Math.abs(points[best].distanceKm - km)
            ? i
            : best,
        0,
      ),
    );
  }
  return (
    <section
      className={styles.chart}
      aria-labelledby={`${id}-title`}
      aria-busy={hasPoints && !ready}
    >
      <div className={styles.heading}>
        <div>
          <h2 id={`${id}-title`}>
            <Gauge size={18} />
            Скорость
          </h2>
          <p>По открытой части маршрута · км/ч</p>
        </div>
        {!!points.length && (
          <div className={styles.readout} aria-live="polite">
            {active ? (
              <>
                <strong>{format(active.speedKmh)}</strong> км/ч{" "}
                <span>на {format(active.distanceKm)} км</span>
              </>
            ) : (
              <>
                <strong>
                  {format(Math.max(...points.map((p) => p.speedKmh)))}
                </strong>{" "}
                км/ч <span>максимум на графике</span>
              </>
            )}
          </div>
        )}
      </div>
      {points.length ? (
        <>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} 195`}
            role="img"
            aria-label="График скорости по расстоянию"
            onPointerEnter={selectPoint}
            onPointerMove={selectPoint}
            onPointerDown={selectPoint}
            onPointerLeave={() => setSelected(null)}
          >
            <defs>
              <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
                <stop stopColor="var(--chart-line)" stopOpacity=".16" />
                <stop
                  offset="1"
                  stopColor="var(--chart-line)"
                  stopOpacity="0"
                />
              </linearGradient>
            </defs>
            <rect
              width={width}
              height="195"
              fill="transparent"
              pointerEvents="all"
            />
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line
                  x1="42"
                  x2={width - 42}
                  y1={160 - t * 136}
                  y2={160 - t * 136}
                  className={styles.grid}
                />
                <text x="30" y={164 - t * 136} textAnchor="end">
                  {maxSpeed * t}
                </text>
              </g>
            ))}
            {profile
              .filter((run) => run.length)
              .map((run, i) => {
                const line = run
                  .map((p, n) => `${n ? "L" : "M"}${x(p)} ${y(p)}`)
                  .join(" ");
                return (
                  <g key={i}>
                    <path
                      d={`${line} L${x(run.at(-1))} 160 L${x(run[0])} 160 Z`}
                      fill={`url(#${id}-fill)`}
                    />
                    <path d={line} className={styles.line} />
                    {run.length === 1 && (
                      <circle
                        cx={x(run[0])}
                        cy={y(run[0])}
                        r="3"
                        fill="var(--chart-line)"
                      />
                    )}
                  </g>
                );
              })}
            <text x="42" y="185">
              0 км
            </text>
            <text x={width - 42} y="185" textAnchor="end">
              {format(maxDistance)} км
            </text>
            {active && (
              <g>
                <line
                  x1={x(active)}
                  x2={x(active)}
                  y1="20"
                  y2="160"
                  className={styles.cursor}
                />
                <circle
                  cx={x(active)}
                  cy={y(active)}
                  r="4"
                  fill="var(--chart-line)"
                />
              </g>
            )}
          </svg>
          <details className={styles.data}>
            <summary>Значения скорости</summary>
            <div>
              <table>
                <thead>
                  <tr>
                    <th>Расстояние, км</th>
                    <th>Скорость, км/ч</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((p, i) => (
                    <tr key={i}>
                      <td>{format(p.distanceKm)}</td>
                      <td>{format(p.speedKmh)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className={styles.empty}>
          Для графика нужны точки GPX с отметками времени на открытом участке
          маршрута.
        </p>
      )}
    </section>
  );
}
