"use client";
import type * as React from "react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Info } from "./icons.tsx";
import styles from "./info-tip.module.css";

// A hint behind an «i» (#378): the sentence that used to stand under a field
// as a paragraph. It opens on hover (a mouse), on the keyboard focus and on a
// tap or a click, which pins it; Escape, a press elsewhere, leaving the control
// and scrolling close it. The text is always in the page and is the
// description of the button, so a screen reader reads it without opening
// anything; the bubble is placed by the viewport, not by the scrolling box of
// the form it stands in.
const margin = 8;
export default function InfoTip({
  label,
  children,
  className = "",
  id: given,
}: {
  /** What the hint is about: «Подробнее: Найти место». */
  label: string;
  children: React.ReactNode;
  className?: string;
  /** Another element may describe itself by this hint (`aria-describedby`). */
  id?: string;
}) {
  const own = useId(),
    id = given || own;
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => {
    pinned.current = false;
    setOpen(false);
  }, []);
  // Placed under the icon, kept inside the viewport.
  useLayoutEffect(() => {
    const anchor = button.current;
    const box = bubble.current;
    if (!open || !anchor || !box) return;
    const icon = anchor.getBoundingClientRect();
    const width = Math.min(box.offsetWidth, window.innerWidth - 2 * margin);
    const left = Math.min(
      Math.max(margin, icon.left + icon.width / 2 - width / 2),
      window.innerWidth - margin - width,
    );
    const below = icon.bottom + 6;
    const fits = below + box.offsetHeight <= window.innerHeight - margin;
    box.style.left = `${left}px`;
    box.style.top = `${fits ? below : Math.max(margin, icon.top - 6 - box.offsetHeight)}px`;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => {
      if (
        event.target instanceof Node &&
        (button.current?.contains(event.target) ||
          bubble.current?.contains(event.target))
      )
        return;
      close();
    };
    document.addEventListener("pointerdown", away, true);
    // The form scrolls under a fixed bubble: it would be left behind.
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);
  return (
    <span className={styles.tip + (className ? " " + className : "")}>
      <button
        ref={button}
        type="button"
        className={styles.button}
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") setOpen(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse" && !pinned.current) setOpen(false);
        }}
        onFocus={(e) => {
          // A tap focuses too, and its click decides: only the keyboard opens here.
          if (e.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
        onBlur={close}
        onClick={() => {
          if (open && pinned.current) close();
          else {
            pinned.current = true;
            setOpen(true);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            // Only the hint closes; the window it stands in stays.
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <span
        ref={bubble}
        id={id}
        role="tooltip"
        className={styles.bubble}
        hidden={!open}
      >
        {children}
      </span>
    </span>
  );
}
