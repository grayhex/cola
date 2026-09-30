"use client";
import type * as React from "react";
import type * as MiniMotion from "motion/mini";
import { ViewTransition, useEffect, useRef, useSyncExternalStore } from "react";
import { cssBezier } from "../../lib/motion-easing.ts";

const preference = () => window.matchMedia("(prefers-reduced-motion: reduce)");
function subscribe(listener: () => void) {
  const media = preference();
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
const reducedSnapshot = () => preference().matches;
const serverSnapshot = () => true;
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, reducedSnapshot, serverSnapshot);
}

// Native Next links own navigation, focus and history. Only the named leaf
// participates; unrelated updates and the rest of the document stay still.
export function SharedView({
  kind,
  id,
  children,
}: {
  kind: string;
  id?: string | null;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <ViewTransition
      name={id && !reduced ? `cola-${kind}-${id}` : undefined}
      default="none"
      share={reduced ? "none" : "cola-shared"}
    >
      {children}
    </ViewTransition>
  );
}

export function MotionList({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <ViewTransition
      default="none"
      update={reduced ? "none" : "cola-list"}
      enter={reduced ? "none" : "cola-enter"}
      exit={reduced ? "none" : "cola-exit"}
    >
      {children}
    </ViewTransition>
  );
}

// Import the tiny WAAPI-based Motion entry only for an interaction, never for
// first paint. Failure or a slow import must not delay or hide the real state.
let runtime: Promise<typeof MiniMotion> | null;
function loadMotion() {
  return (runtime ??= import("motion/mini").catch((error) => {
    runtime = null;
    throw error;
  }));
}
export function useMotionFeedback(
  value: unknown,
  { reveal = false }: { reveal?: boolean } = {},
) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(value);
  const reduced = useReducedMotion();
  useEffect(() => {
    const changed = previous.current !== value;
    previous.current = value;
    const element = ref.current;
    if (!changed || reduced || !element || (reveal && !value)) return;
    let disposed = false;
    let animation: ReturnType<typeof MiniMotion.animate> | undefined;
    const before = {
      transform: element.style.transform,
    };
    const restore = () => Object.assign(element.style, before);
    const started = performance.now();
    loadMotion()
      .then(({ animate }) => {
        if (
          disposed ||
          !element.isConnected ||
          preference().matches ||
          performance.now() - started > 200
        )
          return;
        const style = getComputedStyle(element);
        const duration =
          parseFloat(style.getPropertyValue("--duration-fast")) / 1000;
        animation = animate(
          element,
          reveal
            ? {
                // Revealed panels contain text: keep its contrast throughout
                // the animation, including paused/background WebKit frames.
                transform: ["translateY(-2px)", "translateY(0)"],
              }
            : { transform: ["scale(1)", "scale(1.12)", "scale(1)"] },
          { duration, ease: cssBezier(style.getPropertyValue("--ease-out")) },
        );
        // Mini commits its final keyframes inline. Restore the original styles
        // so CSS hover/press feedback and future theme changes still apply.
        animation.then(() => {
          if (!disposed) {
            animation!.cancel();
            restore();
          }
        });
      })
      .catch(() => {});
    return () => {
      disposed = true;
      animation?.cancel();
      restore();
    };
  }, [value, reduced, reveal]);
  return ref;
}
