"use client";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "./motion.jsx";
import styles from "./bike-carousel.module.css";

// A row of cards that scrolls sideways (#254): the thin scrollbar shows there
// is more; wheel, touch, mouse drag and the arrow, Home and End keys move it.
export default function BikeCarousel({ children, busy }) {
  const rail = useRef(null),
    cancel = useRef(null),
    sequence = useRef(0),
    drag = useRef(null);
  const reduced = useReducedMotion();
  function stop() {
    sequence.current++;
    cancel.current?.();
    cancel.current = null;
  }
  useEffect(() => stop, []);
  useEffect(() => {
    if (reduced) stop();
  }, [reduced]);
  async function move(target) {
    stop();
    const node = rail.current;
    target = Math.max(0, Math.min(node.scrollWidth - node.clientWidth, target));
    if (reduced) {
      node.scrollLeft = target;
      return;
    }
    const token = sequence.current;
    try {
      const { scrollCarousel } = await import("./interaction-motion.js");
      if (token !== sequence.current || !node.isConnected) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        node.scrollLeft = target;
        return;
      }
      cancel.current = scrollCarousel(node, target);
    } catch {
      if (token === sequence.current) node.scrollLeft = target;
    }
  }
  return (
    <div
      className={styles.carousel}
      role="region"
      aria-label="Карусель популярных велосипедов"
    >
      <div
        ref={rail}
        className={styles.rail}
        tabIndex={0}
        aria-label="Велосипеды; используйте стрелки для прокрутки"
        aria-busy={busy}
        onWheel={stop}
        onTouchStart={stop}
        onDragStart={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (
            e.pointerType !== "mouse" ||
            e.button !== 0 ||
            e.target.closest("button,input")
          )
            return;
          stop();
          drag.current = {
            x: e.clientX,
            left: e.currentTarget.scrollLeft,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          const state = drag.current;
          if (!state || !e.buttons) return;
          if (Math.abs(e.clientX - state.x) > 6) {
            state.moved = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            e.currentTarget.dataset.dragging = "true";
          }
          if (state.moved)
            e.currentTarget.scrollLeft = state.left + state.x - e.clientX;
        }}
        onPointerUp={(e) => {
          delete e.currentTarget.dataset.dragging;
          if (!drag.current?.moved) drag.current = null;
        }}
        onPointerCancel={(e) => {
          drag.current = null;
          delete e.currentTarget.dataset.dragging;
        }}
        onClickCapture={(e) => {
          if (drag.current?.moved) {
            e.preventDefault();
            e.stopPropagation();
          }
          drag.current = null;
        }}
        onKeyDown={(e) => {
          if (
            e.target !== e.currentTarget ||
            !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
          )
            return;
          e.preventDefault();
          const node = e.currentTarget;
          move(
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? node.scrollWidth
                : node.scrollLeft +
                  (e.key === "ArrowLeft" ? -1 : 1) * node.clientWidth,
          );
        }}
      >
        {children}
      </div>
    </div>
  );
}
