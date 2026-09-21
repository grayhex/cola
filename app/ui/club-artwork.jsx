"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./global-header.module.css";
export function HeaderArtwork({ settings }) {
  const [failed, setFailed] = useState(null);
  const img = useRef(null);
  useEffect(() => {
    if (img.current?.complete && !img.current.naturalWidth)
      setFailed(settings.logoId);
  }, [settings.logoId]);
  return settings.logoId && failed !== settings.logoId ? (
    <img
      ref={img}
      className={`site-logo ${styles.artwork}`}
      src={"/api/assets/" + settings.logoId}
      alt=""
      onError={() => setFailed(settings.logoId)}
    />
  ) : (
    <span className={styles.wordmark}>{settings.siteName}</span>
  );
}
export function ClubPanorama({ settings }) {
  const [failed, setFailed] = useState(null);
  const img = useRef(null);
  useEffect(() => {
    if (img.current?.complete && !img.current.naturalWidth)
      setFailed(settings.garageImageId);
  }, [settings.garageImageId]);
  if (!settings.garageImageId) return null;
  return (
    <div className={`garage-banner-shell ${styles.panorama}`}>
      <img
        ref={img}
        className="garage-banner"
        src={"/api/assets/" + settings.garageImageId}
        alt=""
        style={
          failed === settings.garageImageId
            ? { visibility: "hidden" }
            : undefined
        }
        onError={() => setFailed(settings.garageImageId)}
      />
    </div>
  );
}
