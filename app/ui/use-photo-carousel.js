"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./motion.jsx";

export function usePhotoCarousel(count) {
  const rail = useRef(null),
    cancel = useRef(null),
    sequence = useRef(0),
    drag = useRef(null);
  const [position, setPosition] = useState(0);
  const reduced = useReducedMotion();
  const active = Math.max(0, Math.min(count - 1, position));
  const stop = useCallback(() => {
    sequence.current++;
    cancel.current?.();
    cancel.current = null;
    if (rail.current) rail.current.style.scrollSnapType = "";
  }, []);
  const move = useCallback(
    async (index, animated = true) => {
      stop();
      const node = rail.current;
      if (!node || !count) return;
      index = Math.max(0, Math.min(count - 1, index));
      const target = index * node.clientWidth;
      if (reduced || !animated) {
        node.scrollLeft = target;
        setPosition(index);
        return;
      }
      const token = sequence.current;
      const started = performance.now();
      try {
        const { scrollPhotoCarousel } = await import("./interaction-motion.js");
        if (token !== sequence.current || !node.isConnected) return;
        if (
          window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
          performance.now() - started > 200
        ) {
          node.scrollLeft = target;
          setPosition(index);
          return;
        }
        cancel.current = scrollPhotoCarousel(node, target, () => {
          // Native scroll events can be coalesced during animation. Keep the
          // counter, controls and inert slides in sync with the final position.
          if (token === sequence.current)
            setPosition(Math.round(node.scrollLeft / node.clientWidth));
        });
      } catch {
        if (token === sequence.current) {
          node.scrollLeft = target;
          setPosition(index);
        }
      }
    },
    [count, reduced, stop],
  );
  useEffect(() => {
    const node = rail.current;
    if (!node) return;
    let width = node.clientWidth;
    const resize = new ResizeObserver(() => {
      if (width === node.clientWidth) return;
      const index = width ? Math.round(node.scrollLeft / width) : 0;
      width = node.clientWidth;
      stop();
      node.scrollLeft = Math.min(index, count - 1) * width;
    });
    resize.observe(node);
    let lastWheel = 0;
    const wheel = (event) => {
      // Horizontal trackpads keep native scrolling. Vertical wheel moves one
      // photo, then releases page scrolling at either end; browser zoom is free.
      if (event.ctrlKey) return;
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
        stop();
        return;
      }
      if (!event.deltaY) return;
      const index = Math.round(node.scrollLeft / node.clientWidth);
      const next = index + Math.sign(event.deltaY);
      if (next < 0 || next >= count) return;
      event.preventDefault();
      if (performance.now() - lastWheel < 300) return;
      lastWheel = performance.now();
      void move(next);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      resize.disconnect();
      node.removeEventListener("wheel", wheel);
      stop();
    };
  }, [count, move, stop]);
  useEffect(() => {
    if (reduced) stop();
  }, [reduced, stop]);
  return {
    rail,
    active,
    move,
    events: {
      onScroll(e) {
        setPosition(
          Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth),
        );
      },
      onTouchStart: stop,
      onDragStart(e) {
        e.preventDefault();
      },
      onPointerDown(e) {
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        stop();
        drag.current = {
          x: e.clientX,
          left: e.currentTarget.scrollLeft,
          moved: false,
        };
      },
      onPointerMove(e) {
        const state = drag.current;
        if (!state || !e.buttons) return;
        if (Math.abs(e.clientX - state.x) > 6) {
          state.moved = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.style.scrollSnapType = "none";
          e.currentTarget.dataset.dragging = "true";
        }
        if (state.moved)
          e.currentTarget.scrollLeft = state.left + state.x - e.clientX;
      },
      onPointerUp(e) {
        delete e.currentTarget.dataset.dragging;
        if (drag.current?.moved)
          void move(
            Math.round(
              e.currentTarget.scrollLeft / e.currentTarget.clientWidth,
            ),
          );
        else drag.current = null;
      },
      onPointerCancel(e) {
        drag.current = null;
        delete e.currentTarget.dataset.dragging;
        stop();
      },
      onClickCapture(e) {
        if (drag.current?.moved) {
          e.preventDefault();
          e.stopPropagation();
        }
        drag.current = null;
      },
      onKeyDown(e) {
        if (
          e.target !== e.currentTarget ||
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
        )
          return;
        e.preventDefault();
        void move(
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? count - 1
              : active + (e.key === "ArrowLeft" ? -1 : 1),
        );
      },
    },
  };
}
