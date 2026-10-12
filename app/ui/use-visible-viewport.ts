"use client";
import { useLayoutEffect, type RefObject } from "react";

/** Fixed panels follow the visible area, including keyboard panning. Zoom keeps
 * its native layout: resizing a panel while pinching would undo the user's zoom.
 * CSS uses dvh when VisualViewport is unavailable. */
export function useVisibleViewport(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
) {
  useLayoutEffect(() => {
    const element = ref.current;
    const viewport = window.visualViewport;
    if (!enabled || !element || !viewport) return;
    let frame = 0;
    let previousHeight = viewport.height;
    let previousWidth = viewport.width;
    const update = () => {
      if (viewport.scale !== 1) return;
      const reveal =
        viewport.height < previousHeight || viewport.width !== previousWidth;
      previousHeight = viewport.height;
      previousWidth = viewport.width;
      element.style.setProperty("--visible-height", `${viewport.height}px`);
      element.style.setProperty("--visible-width", `${viewport.width}px`);
      element.style.setProperty("--visible-top", `${viewport.offsetTop}px`);
      element.style.setProperty("--visible-left", `${viewport.offsetLeft}px`);
      element.dataset.visibleContracted = String(
        viewport.height < window.innerHeight - 120,
      );
      element.style.setProperty(
        "--visible-bottom",
        `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`,
      );
      // Keyboard animation can resize a dialog after native focus has already
      // scrolled its field. Reveal it again in the resized content scroller;
      // growing the viewport and ordinary panning do not pull the user back.
      const active = document.activeElement;
      if (
        reveal &&
        active instanceof HTMLElement &&
        element.contains(active) &&
        active.matches('input, textarea, [contenteditable="true"]')
      )
        active.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: "instant",
        });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      for (const name of ["height", "width", "top", "left", "bottom"])
        element.style.removeProperty("--visible-" + name);
      delete element.dataset.visibleContracted;
    };
  }, [ref, enabled]);
}
