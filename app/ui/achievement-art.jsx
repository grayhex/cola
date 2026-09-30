"use client";
import { useEffect, useRef, useState } from "react";
import { Trophy, Medal } from "./icons.jsx";
import { gameArtworkSource } from "../../lib/gamification-assets.ts";

// Small shelf icons load as soon as they mount. Their first paint must not
// depend on lazy scheduling, deferred decoding or a later hover/interaction.
// Below the fold (the home records, #254) `loading="lazy"` waits for the
// scroll; the fallback icon holds the place meanwhile.
export default function AchievementArt({
  imageId,
  kind = "record",
  size = 40,
  loading = "eager",
}) {
  const src = gameArtworkSource(imageId, size);
  const [imageState, setImageState] = useState({
    src: null,
    status: "loading",
  });
  const image = useRef(null);
  const state = imageState.src === src ? imageState.status : "loading";
  useEffect(() => {
    const node = image.current;
    // A cached response may complete before React installs the load handler.
    if (src && node?.complete)
      setImageState({ src, status: node.naturalWidth ? "loaded" : "error" });
  }, [src]);
  const Fallback = kind === "record" ? Trophy : Medal;
  return (
    <span
      className="game-art"
      style={{ "--game-art-size": `${size}px` }}
      aria-hidden="true"
      data-image-state={src ? state : "empty"}
    >
      {src && state !== "error" && (
        <img
          key={src}
          ref={image}
          src={src}
          alt=""
          width={size}
          height={size}
          loading={loading}
          decoding={loading === "lazy" ? "async" : "sync"}
          onLoad={() => setImageState({ src, status: "loaded" })}
          onError={() => setImageState({ src, status: "error" })}
        />
      )}
      {(!src || state !== "loaded") && <Fallback size={size} />}
    </span>
  );
}
