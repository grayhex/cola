"use client";
import { useEffect, useRef, useState } from "react";
import GlobalHeader from "../ui/global-header.jsx";
import { ClubPanorama } from "../ui/club-artwork.jsx";
import { fontStacks } from "../../lib/fonts.js";
import { accentText } from "../../lib/appearance.js";
import styles from "./panorama-preview.module.css";
function Viewport({ width, settings, label }) {
  const outer = useRef(null),
    inner = useRef(null);
  const [size, setSize] = useState({ scale: 1, height: 180 });
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const scale = Math.min(1, outer.current.clientWidth / width);
      setSize({ scale, height: inner.current.offsetHeight * scale });
    });
    observer.observe(outer.current);
    observer.observe(inner.current);
    return () => observer.disconnect();
  }, [width]);
  return (
    <figure className={styles.figure}>
      <figcaption>
        {label} · {width} px
      </figcaption>
      <div
        ref={outer}
        className={styles.viewport}
        style={{ height: size.height }}
      >
        <div
          ref={inner}
          className={styles.canvas}
          inert
          style={{
            width,
            transform: `scale(${size.scale})`,
            "--site-font": fontStacks[settings.font],
            "--accent": settings.accent,
            "--accent-ink": accentText(settings.accent),
          }}
        >
          <GlobalHeader previewSettings={settings} />
          <ClubPanorama settings={settings} />
        </div>
      </div>
    </figure>
  );
}
export default function PanoramaPreview({ settings }) {
  return (
    <div className={styles.previews}>
      <Viewport width={1440} settings={settings} label="Desktop" />
      <Viewport width={390} settings={settings} label="Mobile" />
    </div>
  );
}
