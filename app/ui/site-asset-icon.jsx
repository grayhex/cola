"use client";
import { useEffect, useRef, useState } from "react";
import { useSite } from "./site-provider.jsx";
import { iconPackOverride, semanticIconName } from "../../lib/icon-pack.js";
import { SiteIcon } from "./icons.jsx";

export default function SiteAssetIcon({
  assetId,
  Fallback,
  name,
  size = 24,
  className = "",
  fallbackProps = {},
}) {
  const [failed, setFailed] = useState(null);
  const img = useRef(null);
  useEffect(() => {
    if (img.current?.complete && !img.current.naturalWidth) setFailed(assetId);
  }, [assetId]);
  const { personalSettings: settings } = useSite();
  const semantic =
    name ||
    (Fallback.displayName === "Plus"
      ? "add_bike"
      : semanticIconName(Fallback.displayName));
  // Explicit null resets a semantic slot even when the old dedicated slot exists.
  if (semantic && iconPackOverride(settings, semantic) !== undefined)
    return (
      <SiteIcon
        name={semantic}
        size={size}
        className={"site-asset-icon " + className}
        {...fallbackProps}
      />
    );
  if (assetId && failed !== assetId)
    return (
      <img
        ref={img}
        className={"site-asset-icon " + className}
        src={"/api/assets/" + assetId}
        onError={() => setFailed(assetId)}
        alt=""
        width={size}
        height={size}
        aria-hidden="true"
      />
    );
  return (
    <Fallback
      className={"site-asset-icon-fallback " + className}
      size={size}
      aria-hidden="true"
      {...fallbackProps}
    />
  );
}
