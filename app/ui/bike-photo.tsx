"use client";
import type { BikeDto, PublicPhoto } from "../../lib/contracts.ts";
import { useEffect, useRef, useState } from "react";
import { Camera } from "./icons.tsx";
import { useSite } from "./site-provider.tsx";
const demoImage =
  "https://dma.canyon.com/image/upload/w_930%2Ch_487%2Cc_fit/f_auto/q_auto/v1760425750/2025_FULL_grizl_al-7-raw_4527_R075_P08_ujmfyh";
// Card width on the showcase grid: one column on phones, two on tablets.
const cardSizes = "(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 420px";
export const photoVariants = (id: string, widths = [320, 640, 1280]) =>
  widths.map((w) => `/api/photos/${id}?width=${w} ${w}w`).join(", ");
// `full` keeps the original (photo viewer); `priority` loads above the fold.
export default function Photo({
  bike,
  className = "",
  photo,
  sizes = cardSizes,
  priority = false,
  full = false,
}: {
  bike: Pick<
    BikeDto,
    "id" | "brand" | "model" | "name" | "category" | "photos"
  >;
  className?: string;
  photo?: PublicPhoto | null;
  sizes?: string;
  priority?: boolean;
  full?: boolean;
}) {
  const { settings, t } = useSite();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const image = useRef<HTMLImageElement>(null);
  const selected = photo || bike.photos?.[0];
  const variant = bike.id !== "demo" && selected && !full;
  const src =
    bike.id === "demo"
      ? settings.demoImageId
        ? "/api/assets/" + settings.demoImageId
        : demoImage
      : selected
        ? "/api/photos/" + selected.id + (variant ? "?width=640" : "")
        : settings[
              (bike.category + "ImageId") as
                "mtbImageId" | "roadImageId" | "gravelImageId"
            ]
          ? "/api/assets/" +
            settings[
              (bike.category + "ImageId") as
                "mtbImageId" | "roadImageId" | "gravelImageId"
            ]
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
      {...(variant ? { srcSet: photoVariants(selected.id), sizes } : {})}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
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
