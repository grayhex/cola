"use client";
import { useEffect, useState } from "react";

// Where the reader is on the bike page (#291): the last section whose top
// edge has passed just under the sticky header. The menu stays plain anchor
// links; this only marks the current one. `null` until the page is measured,
// so the server HTML and the first client render are the same.
export function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join("|");
  useEffect(() => {
    const sections = key ? key.split("|") : [];
    let frame = 0;
    const measure = () => {
      frame = 0;
      const header = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--header-height",
        ),
      );
      // Section anchors stop one scroll margin below the header.
      const line = (Number.isFinite(header) ? header : 64) + 48;
      let current = sections[0] ?? null;
      for (const id of sections) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= line) current = id;
      }
      // A short last section never reaches the line: the end of the page
      // belongs to it.
      const bottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2;
      if (bottom && window.scrollY > 0) current = sections.at(-1) ?? current;
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Late content (rides, comments) moves the sections without a scroll.
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
    };
  }, [key]);
  return active;
}
