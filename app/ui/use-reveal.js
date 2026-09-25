"use client";
import { useEffect, useRef } from "react";
// Marketing blocks ([data-reveal-item]) fade in once as they scroll into
// view (DESIGN.md → Motion). Server HTML shows everything, so the content is
// there without JavaScript, with reduced motion and for blocks already on
// screen when the page opens: only blocks below the fold wait.
export function useReveal() {
  const root = useRef(null);
  useEffect(() => {
    const element = root.current;
    if (
      !element ||
      !("IntersectionObserver" in window) ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const waiting = [...element.querySelectorAll("[data-reveal-item]")].filter(
      (item) => item.getBoundingClientRect().top > window.innerHeight,
    );
    for (const item of waiting) item.dataset.reveal = "pending";
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.dataset.reveal = "shown";
            observer.unobserve(entry.target);
          }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    for (const item of waiting) observer.observe(item);
    return () => {
      observer.disconnect();
      for (const item of waiting) delete item.dataset.reveal;
    };
  }, []);
  return root;
}
