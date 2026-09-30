// Interaction-only chunk: the initial route never needs the full animation runtime.
import { animate, stagger } from "motion";
import { cssBezier } from "../../lib/motion-easing.ts";
export function revealMenu(element, previous) {
  const rect = element.getBoundingClientRect();
  const x =
    previous && Date.now() - previous.time < 500
      ? previous.left - rect.left
      : 0;
  const links = [...element.querySelectorAll(".nav-menu-link")];
  const before = [element, ...links].map((node) => ({
    node,
    opacity: node.style.opacity,
    transform: node.style.transform,
  }));
  const animations = [
    animate(
      element,
      {
        opacity: [0.75, 1],
        transform: [
          `translate(${x}px, ${x ? 0 : -8}px)`,
          "translate(0px, 0px)",
        ],
      },
      { type: "spring", stiffness: 430, damping: 34, duration: 0.3 },
    ),
    animate(
      links,
      { opacity: [0.5, 1], transform: ["translateY(5px)", "translateY(0px)"] },
      { duration: 0.16, delay: stagger(0.025) },
    ),
  ];
  return () => {
    animations.forEach((animation) => animation.cancel());
    for (const { node, opacity, transform } of before)
      Object.assign(node.style, { opacity, transform });
  };
}
export function scrollCarousel(element, target) {
  let active = true;
  const animation = animate(element.scrollLeft, target, {
    type: "spring",
    stiffness: 180,
    damping: 28,
    restDelta: 1,
    onUpdate: (value) => {
      if (active) element.scrollLeft = value;
    },
  });
  return () => {
    // Motion may sample one final frame in stop(); manual input owns the rail.
    active = false;
    animation.stop();
  };
}

export function scrollPhotoCarousel(element, target, onComplete = () => {}) {
  let active = true;
  element.style.scrollSnapType = "none";
  const style = getComputedStyle(element);
  const animation = animate(element.scrollLeft, target, {
    duration: parseFloat(style.getPropertyValue("--duration")) / 1000,
    ease: cssBezier(style.getPropertyValue("--ease-out")),
    onUpdate(value) {
      if (active) element.scrollLeft = value;
    },
    onComplete() {
      if (active) {
        element.style.scrollSnapType = "";
        onComplete();
      }
    },
  });
  return () => {
    active = false;
    animation.stop();
    element.style.scrollSnapType = "";
  };
}
