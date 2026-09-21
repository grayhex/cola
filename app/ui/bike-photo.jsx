"use client";
import { useEffect, useRef, useState } from "react";
import { Camera } from "./icons.jsx";
import { useSite } from "./site-provider.jsx";
const demoImage =
  "https://dma.canyon.com/image/upload/w_930%2Ch_487%2Cc_fit/f_auto/q_auto/v1760425750/2025_FULL_grizl_al-7-raw_4527_R075_P08_ujmfyh";
export default function Photo({ bike, className = "", photo }) {
  const { settings, catalog, t } = useSite();
  const { categories, models, parts, partCategories, manufacturers } = catalog;
  const [failedSrc, setFailedSrc] = useState(null);
  const image = useRef(null);
  const selected = photo || bike.photos?.[0];
  const src =
    bike.id === "demo"
      ? settings.demoImageId
        ? "/api/assets/" + settings.demoImageId
        : demoImage
      : selected
        ? "/api/photos/" + selected.id
        : settings[bike.category + "ImageId"]
          ? "/api/assets/" + settings[bike.category + "ImageId"]
          : null;
  useEffect(() => {
    // A cached/fast failure may precede hydration or this effect (notably WebKit).
    // Key failures by source so a new photo can load without resetting an error.
    if (image.current?.complete && !image.current.naturalWidth)
      setFailedSrc(src);
  }, [src]);
  return src && failedSrc !== src ? (
    <img
      ref={image}
      className={className}
      src={src}
      alt={`${bike.brand} ${bike.model} — ${bike.name}`}
      onError={() => setFailedSrc(src)}
    />
  ) : (
    <div className={"photo-empty " + className}>
      <Camera size={38} strokeWidth={1} />
      <span>{t("Фотография велосипеда")}</span>
    </div>
  );
}
