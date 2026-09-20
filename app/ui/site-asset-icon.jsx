"use client";
import { useSite } from "./site-provider.jsx";
import { iconPackOverride, semanticIconName } from "../../lib/icon-pack.js";
import { SiteIcon } from "./icons.jsx";

export default function SiteAssetIcon({
  assetId, Fallback, name, size = 24, className = "", fallbackProps = {},
}) {
  const { personalSettings: settings } = useSite();
  const semantic = name || (Fallback.displayName === "Plus" ? "add_bike" : semanticIconName(Fallback.displayName));
  // Explicit null resets a semantic slot even when the old dedicated slot exists.
  if (semantic && iconPackOverride(settings, semantic) !== undefined)
    return <SiteIcon name={semantic} size={size} className={"site-asset-icon " + className} {...fallbackProps} />;
  if (assetId) return (
    <img className={"site-asset-icon " + className} src={"/api/assets/" + assetId}
      alt="" width={size} height={size} aria-hidden="true" />
  );
  return <Fallback className={"site-asset-icon-fallback " + className}
    size={size} aria-hidden="true" {...fallbackProps} />;
}
