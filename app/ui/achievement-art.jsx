"use client";
import { useEffect, useRef, useState } from "react";
import { Trophy, Medal } from "./icons.jsx";

// This box owns its dimensions. Photo-cover rules must never size award artwork.
export default function AchievementArt({
  imageId,
  kind = "record",
  size = 40,
}) {
  const [failedId, setFailedId] = useState(null);
  const image = useRef(null);
  useEffect(() => {
    if (image.current?.complete && !image.current.naturalWidth)
      setFailedId(imageId);
  }, [imageId]);
  const Fallback = kind === "record" ? Trophy : Medal;
  return (
    <span
      className="game-art"
      style={{ "--game-art-size": `${size}px` }}
      aria-hidden="true"
    >
      {imageId && imageId !== failedId ? (
        <img
          ref={image}
          src={"/api/assets/" + imageId}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailedId(imageId)}
        />
      ) : (
        <Fallback size={size} />
      )}
    </span>
  );
}
