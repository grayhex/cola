"use client";
import { iconPaths, categoryIcons } from "../../lib/part-icons.js";
export default function PartIcon({ category, name, icons = {}, size = 26 }) {
  const key = name || icons[category] || categoryIcons[category] || "other";
  return (
    <svg
      className="part-icon"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {(iconPaths[key] || iconPaths.other).map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
