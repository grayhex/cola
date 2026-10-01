"use client";
import type { HeroAnimation } from "./content-types.ts";
import { useState } from "react";
import RiveArt from "./rive-art.tsx";
import SmallImage from "./small-image.tsx";
import { useReducedMotion } from "./motion.tsx";
import { useSite } from "./site-provider.tsx";
import styles from "./rive-art.module.css";

export default function HeroArtwork({
  animation,
  darkAnimation,
  imageId,
  playing,
  compact = false,
}: {
  animation?: HeroAnimation;
  darkAnimation?: HeroAnimation;
  imageId?: string | null;
  playing: boolean;
  compact?: boolean;
}) {
  const { resolvedTheme } = useSite();
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const selected =
    resolvedTheme === "dark" && darkAnimation ? darkAnimation : animation;
  const poster = imageId ? "/api/assets/" + imageId : null;
  if (selected?.kind === "builtin" || selected?.kind === "rive")
    return (
      <RiveArt
        name={selected.kind === "builtin" ? selected.name : undefined}
        src={
          "assetId" in selected && selected.assetId
            ? "/api/assets/" + selected.assetId
            : undefined
        }
        poster={poster}
        playing={playing}
        compact={compact}
      />
    );
  const src =
    selected?.kind === "svg" ? "/api/assets/" + selected.assetId : null;
  return (
    <div className={compact ? styles.compact : styles.stage} aria-hidden="true">
      <div
        hidden={
          !!(playing && !reduced && src && loaded === src && failed !== src)
        }
      >
        <SmallImage className={styles.poster} src={poster} alt="" />
      </div>
      {playing && !reduced && src && failed !== src && (
        // Uploaded SVG is already sanitized and must keep its animation bytes.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.svg}
          src={src}
          alt=""
          onError={() => setFailed(src)}
          onLoad={() => setLoaded(src)}
        />
      )}
    </div>
  );
}
