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

// A hint behind an «i» (#378, #382): the sentence that used to stand under a
// field as a paragraph. It opens on hover (a mouse), on the keyboard focus and
// on a tap or a click, which pins it. While it is open it stays open: no timer
// closes it, the pointer may go from the icon to the text (the two are one
// hover area), and neither a scroll of something else nor a resize nor a
// re-render of the form takes it away. It closes by the icon pressed again, a
// press elsewhere, Escape (only the hint: the window it stands in stays) and
// by the focus leaving it. A scroll of the box the icon stands in, or a resize
// of the window, places it again. The text is always in the page and is the
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
  // The focus given back to the icon after Escape is not a request to open.
  const returning = useRef(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => {
    pinned.current = false;
    setOpen(false);
  }, []);
  // Placed under the icon, kept inside the viewport; above it when there is no
  // room below.
  const place = useCallback(() => {
    const anchor = button.current;
    const box = bubble.current;
    if (!anchor || !box) return;
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
  }, []);
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node && !!root.current?.contains(target);
    const away = (event: Event) => {
      if (!inside(event.target)) close();
    };
    // Escape closes the hint and nothing else, wherever the focus is: the
    // window the hint stands in treats an Escape it receives as its own.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      // The focus on the hint's text goes back to the icon, and stays closed.
      if (document.activeElement === bubble.current) {
        returning.current = true;
        button.current?.focus({ preventScroll: true });
        returning.current = false;
      }
    };
    // A scroll of something else (a map, a list, the page behind the window)
    // does not move the icon. Only the box the icon stands in does: the hint
    // follows it, and goes with the icon when the icon leaves the screen.
    const scrolled = (event: Event) => {
      const target = event.target;
      const anchor = button.current;
      if (
        !anchor ||
        (target !== document &&
          !(target instanceof Node && target.contains(anchor)))
      )
        return;
      const icon = anchor.getBoundingClientRect();
      if (icon.bottom < 0 || icon.top > window.innerHeight) close();
      else place();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", place);
    };
  }, [open, close, place]);
  return (
    // The icon and the bubble are one hover area: moving the pointer from the
    // one to the other (the bubble has a bridge over the gap) is not leaving.
    <span
      ref={root}
      className={styles.tip + (className ? " " + className : "")}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse" || pinned.current) return;
        // The keyboard focus on the icon keeps it open as well.
        if (button.current?.matches(":focus-visible")) return;
        setOpen(false);
      }}
      onBlur={(e) => {
        // The focus moving inside (the icon to the text) is not leaving.
        if (
          e.relatedTarget instanceof Node &&
          root.current?.contains(e.relatedTarget)
        )
          return;
        close();
      }}
    >
      <button
        ref={button}
        type="button"
        className={styles.button}
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onFocus={(e) => {
          // A tap focuses too, and its click decides: only the keyboard opens here.
          if (!returning.current && e.currentTarget.matches(":focus-visible"))
            setOpen(true);
        }}
        onClick={() => {
          if (open && pinned.current) close();
          else {
            pinned.current = true;
            setOpen(true);
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
        // Pressing the text keeps the hint: it can be read and selected, and
        // the focus pressed into it is still inside.
        tabIndex={-1}
        onPointerDown={() => {
          pinned.current = true;
        }}
      >
        {children}
      </span>
    </span>
  );
}
