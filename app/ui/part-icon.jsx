"use client";
import { iconPaths, categoryIcons } from "../../lib/part-icons.js";
import { useSite } from "./site-provider.jsx";
export default function PartIcon({
  category,
  name,
  icons = {},
  size = 26,
  original = false,
}) {
  const key = name || icons[category] || categoryIcons[category] || "other";
  const { personalSettings: settings } = useSite();
  if (!original && settings.designSystem !== "community" && settings.partIconAssets?.[key])
    return (
      <img
        className="part-icon"
        src={"/api/assets/" + settings.partIconAssets[key]}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        style={{ objectFit: "contain" }}
      />
    );
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
