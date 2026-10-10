"use client";
import { useEffect, useRef, useState } from "react";
import {
  useRive,
  RuntimeLoader,
  Layout,
  Fit,
} from "@rive-app/react-canvas-lite";
import { riveRuntimeVersion } from "../../lib/rive-assets.ts";
import styles from "./planning-graphic.module.css";

// Same pinned, local-only renderer as the former hero. No remote file assets.
RuntimeLoader.setWasmUrl(`/rive/runtime/${riveRuntimeVersion}/rive.wasm`);
RuntimeLoader.setWasmFallbackUrl(
  `/rive/runtime/${riveRuntimeVersion}/rive_fallback.wasm`,
);
export default function PlanningRive({
  src,
  onError,
}: {
  src: string;
  onError?: () => void;
}) {
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false);
  const firstFrame = useRef(false);
  const { rive, RiveComponent } = useRive(
    {
      src,
      autoplay: true,
      layout: new Layout({ fit: Fit.Contain }),
      enableRiveAssetCDN: false,
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
    if (failed) {
      rive?.cleanup();
      onError?.();
    }
  }, [failed, rive, onError]);
  if (failed) return null;
  return (
    <span
      className={styles.canvas}
      data-rive-ready={ready || undefined}
      style={{ visibility: ready ? "visible" : "hidden" }}
    >
      <RiveComponent />
    </span>
  );
}
