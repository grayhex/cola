"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Bike } from "./icons.tsx";
import { useSite } from "./site-provider.tsx";
import { useReducedMotion } from "./motion.tsx";
import styles from "./planning-graphic.module.css";

// This component belongs to the composers' lazy chunk. Merely visiting a
// page with a planning button never loads the image, Rive JS or WASM.
const RiveCanvas = dynamic(() => import("./planning-rive.tsx"), { ssr: false });
export default function PlanningGraphic({
  slot,
  size = "compact",
}: {
  slot: "intentDialogGraphic" | "planDialogGraphic" | "wizardSearchGraphic";
  /** `wide`: the picture above the search of the wizard (#374), not a mark by a title. */
  size?: "compact" | "wide";
}) {
  const { settings } = useSite();
  const reduced = useReducedMotion();
  const graphic = settings[slot];
  const [failed, setFailed] = useState<string | null>(null);
  if (!graphic || failed === graphic.assetId) return null;
  return (
    <span
      className={styles.graphic + (size === "wide" ? " " + styles.wide : "")}
      aria-hidden="true"
      data-planning-graphic={slot}
    >
      {graphic.kind === "rive" || (graphic.kind === "svg" && reduced) ? (
        <>
          <Bike size={36} className={styles.fallback} />
          {!reduced && (
            <RiveCanvas
              key={graphic.assetId}
              src={"/api/assets/" + graphic.assetId}
            />
          )}
        </>
      ) : (
        <Image
          unoptimized
          src={"/api/assets/" + graphic.assetId}
          alt=""
          width={size === "wide" ? 480 : 80}
          height={size === "wide" ? 140 : 56}
          onError={() => setFailed(graphic.assetId)}
        />
      )}
    </span>
  );
}
