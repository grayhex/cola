"use client";
import { useSite } from "./site-provider.jsx";
import { bikeIconName, iconPackOverride } from "../../lib/icon-pack.js";
import { SiteIcon } from "./icons.jsx";
const assetKeys = { mtb: "mtbTypeIconId", road: "roadTypeIconId", gravel: "gravelTypeIconId" };
export default function BikeCategoryIcon({ category, label, size = 28 }) {
  const { personalSettings: settings } = useSite();
  const name = bikeIconName(category, label);
  if (iconPackOverride(settings, name) !== undefined)
    return <SiteIcon name={name} size={size} className="bike-category-graphic" aria-label={label} />;
  const assetId = settings?.[assetKeys[category]];
  if (assetId) return (
    <img className="bike-category-graphic" src={"/api/assets/" + assetId}
      alt={label || ""} width={size} height={size} />
  );
  return (
    <svg className="bike-category-graphic bike-category-fallback" width={size} height={size}
      viewBox="0 0 40 28" fill="none" stroke="currentColor" strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx="9" cy="19" r="7" /><circle cx="31" cy="19" r="7" />
      <path d="M9 19 16 8 22 19H9m7-11 12 1 3 10M22 19l6-10-2-5m-13 3h6" />
      {category === "mtb" ? <path d="m27 4 6-2m-5 10 3 5M5 11l-2-1m34 0-2 1" />
        : !/тур|комьют|коммьют|tour|commut/i.test(label || "")
          ? <path d="M26 4h6q5 0 3 4h-3" /> : <path d="M25 4h7M2 10h11M3 8h10M4 12v9h8v-9" />}
    </svg>
  );
}
