"use client";
import { useEffect, useRef, useState } from "react";
import {
  useRive,
  RuntimeLoader,
  Layout,
  Fit,
} from "@rive-app/react-canvas-lite";
import { riveAssets, riveRuntimeVersion } from "../../lib/rive-assets.ts";
import styles from "./rive-art.module.css";

// Both paths are local. In particular, failure must never fall back to a CDN.
RuntimeLoader.setWasmUrl(`/rive/runtime/${riveRuntimeVersion}/rive.wasm`);
RuntimeLoader.setWasmFallbackUrl(
  `/rive/runtime/${riveRuntimeVersion}/rive_fallback.wasm`,
);

export default function RiveCanvas({ name, src, theme }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const firstFrame = useRef(false);
  const asset = riveAssets[name];
  const { rive, RiveComponent } = useRive(
    {
      src: src || `/rive/${name}-${theme}.riv`,
      artboard: asset?.artboard,
      animations: asset?.animations,
      autoplay: true,
      layout: new Layout({ fit: Fit.Contain }),
      enableRiveAssetCDN: false,
      // These vector-only sources have no external file assets.
      assetLoader: () => true,
      onAdvance: () => {
        if (!firstFrame.current) {
          firstFrame.current = true;
          setReady(true);
        }
      },
      onLoadError: () => setFailed(true),
    },
    { shouldResizeCanvasToContainer: true, useDevicePixelRatio: true },
  );
  useEffect(() => {
    if (ready || failed) return;
    const timeout = setTimeout(() => setFailed(true), 12000);
    return () => clearTimeout(timeout);
  }, [ready, failed]);
  useEffect(() => {
    if (failed) rive?.cleanup();
  }, [failed, rive]);
  if (failed) return null;
  return (
    <div className={styles.canvas} data-rive-ready={ready || undefined}>
      <RiveComponent />
    </div>
  );
}
