"use client";
import { encode } from "uqr";

// A QR code of the ride's canonical address (#235), drawn as one SVG path.
// Loaded only when someone opens it; the code is just the address, never a
// key: whoever scans it still passes the page's access checks.
export default function RideQr({ value }) {
  const { size, data } = encode(value, { ecc: "M", border: 0 });
  let path = "";
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    }),
  );
  const quiet = 4;
  return (
    <svg
      viewBox={`${-quiet} ${-quiet} ${size + quiet * 2} ${size + quiet * 2}`}
      role="img"
      aria-label="QR-код ссылки на покатушку"
      shapeRendering="crispEdges"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
