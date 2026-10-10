import { routePaths } from "../../lib/ride-geometry.ts";
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
