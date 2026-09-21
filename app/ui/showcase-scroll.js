"use client";
import { useEffect } from "react";

// Scroll coordinates only: public data and permissions are always fetched again.
const positions = new Map();
let returning = null;
export function useBrowseHistory() {
  useEffect(() => {
    function back() {
      const href = window.location.href;
      returning = positions.has(href) ? { href, y: positions.get(href) } : null;
    }
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
}
export function useShowcaseScroll(ready) {
  useEffect(() => {
    if (!ready || returning?.href !== window.location.href) return;
    const target = returning;
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: target.y, behavior: "instant" });
      if (returning === target) returning = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [ready]);
  return (event) => {
    if (
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = event.target.closest("a[href]");
    if (
      !link ||
      link.target === "_blank" ||
      link.origin !== window.location.origin
    )
      return;
    positions.set(window.location.href, window.scrollY);
    if (positions.size > 20) positions.delete(positions.keys().next().value);
  };
}
