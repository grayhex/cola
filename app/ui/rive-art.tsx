"use client";
import type { ReactNode } from "react";
import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import SmallImage from "./small-image.tsx";
import { useReducedMotion } from "./motion.tsx";
import { useSite } from "./site-provider.tsx";
import styles from "./rive-art.module.css";

const Canvas = lazy(() => import("./rive-canvas.tsx"));
class CanvasBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function RiveArt({
  name,
  src,
  poster,
  playing,
  compact = false,
}: {
  name?: string;
  src?: string;
  poster?: string | null;
  playing: boolean;
  compact?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const reduced = useReducedMotion();
  const { resolvedTheme } = useSite();
  useEffect(() => {
    if (!playing || reduced || !window.IntersectionObserver) return;
    // Canvas and WASM are optional; skip the runtime entirely when unavailable.
    try {
      if (
        !window.WebAssembly ||
        !document.createElement("canvas").getContext("2d")
      )
        return;
    } catch {
      return;
    }
    let intersects = false;
    const update = () => setVisible(intersects && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      intersects = entry.isIntersecting && entry.intersectionRatio > 0;
      update();
    });
    if (host.current) observer.observe(host.current);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      setVisible(false);
    };
  }, [playing, reduced]);
  return (
    <div
      ref={host}
      className={compact ? styles.compact : styles.stage}
      data-rive-art={name || "custom"}
      aria-hidden="true"
    >
      {(poster || !name) && (
        <SmallImage className={styles.poster} src={poster} alt="" />
      )}
      <div
        className={styles.art}
        data-crop={(compact && name === "transparent-bike") || undefined}
      >
        {!poster &&
          name &&
          (["light", "dark"] as const).map((theme) => (
            <SmallImage
              key={theme}
              className={styles[theme]}
              src={`/rive/${name}-${theme}.png`}
              alt=""
            />
          ))}
        {playing && !reduced && visible && (
          <CanvasBoundary key={src || name + resolvedTheme}>
            <Suspense fallback={null}>
              <Canvas
                name={name}
                src={src}
                theme={resolvedTheme === "dark" ? "dark" : "light"}
              />
            </Suspense>
          </CanvasBoundary>
        )}
      </div>
    </div>
  );
}
