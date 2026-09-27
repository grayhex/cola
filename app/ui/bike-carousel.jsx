"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useReducedMotion } from "./motion.jsx";
import styles from "./bike-carousel.module.css";

export default function BikeCarousel({ children, busy }) {
  const rail = useRef(null),
    cancel = useRef(null),
    sequence = useRef(0),
    drag = useRef(null);
  const [position, setPosition] = useState({ left: 0, max: 0 });
  const reduced = useReducedMotion();
  const id = useId();
  function stop() {
    sequence.current++;
    cancel.current?.();
    cancel.current = null;
  }
  useEffect(() => {
    const node = rail.current;
    let frame;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setPosition({
          left: node.scrollLeft,
          max: Math.max(0, node.scrollWidth - node.clientWidth),
        }),
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    node.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", measure);
      cancelAnimationFrame(frame);
      stop();
    };
  }, [children]);
  useEffect(() => {
    if (reduced) stop();
  }, [reduced]);
  async function move(target, animate = true) {
    stop();
    const node = rail.current;
    target = Math.max(0, Math.min(node.scrollWidth - node.clientWidth, target));
    if (reduced || !animate) {
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
  const progress = position.max
    ? Math.min(100, Math.max(0, (position.left / position.max) * 100))
    : 0;
  return (
    <div
      className={styles.carousel}
      role="region"
      aria-label="Карусель популярных велосипедов"
    >
      <div
        ref={rail}
        id={id}
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
          move(
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? position.max
                : rail.current.scrollLeft +
                  (e.key === "ArrowLeft" ? -1 : 1) * rail.current.clientWidth,
          );
        }}
      >
        {children}
      </div>
      <div className={styles.controls}>
        <button
          className="icon"
          type="button"
          aria-label="Предыдущие велосипеды"
          aria-controls={id}
          disabled={position.left < 1}
          onClick={() =>
            move(rail.current.scrollLeft - rail.current.clientWidth)
          }
        >
          <ChevronLeft size={18} />
        </button>
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={progress}
          disabled={position.max < 1}
          aria-label="Позиция в популярных велосипедах"
          aria-controls={id}
          aria-valuetext={`${Math.round(progress)}%`}
          style={{ "--progress": progress + "%" }}
          onChange={(e) =>
            move((Number(e.target.value) / 100) * position.max, false)
          }
        />
        <button
          className="icon"
          type="button"
          aria-label="Следующие велосипеды"
          aria-controls={id}
          disabled={position.max - position.left < 1}
          onClick={() =>
            move(rail.current.scrollLeft + rail.current.clientWidth)
          }
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
