// Interaction-only chunk: the initial route never needs the full animation runtime.
import { animate, stagger } from "motion";
export function revealMenu(element, previous) {
  const rect = element.getBoundingClientRect();
  const x =
    previous && Date.now() - previous.time < 500
      ? previous.left - rect.left
      : 0;
  const animations = [
    animate(
      element,
      { opacity: [0.75, 1], x: [x, 0], y: [x ? 0 : -8, 0] },
      { type: "spring", stiffness: 430, damping: 34, duration: 0.3 },
    ),
    animate(
      [...element.querySelectorAll(".nav-menu-link")],
      { opacity: [0.5, 1], y: [5, 0] },
      { duration: 0.16, delay: stagger(0.025) },
    ),
  ];
  return () => animations.forEach((animation) => animation.cancel());
}
export function scrollCarousel(element, target) {
  const animation = animate(element.scrollLeft, target, {
    type: "spring",
    stiffness: 180,
    damping: 28,
    restDelta: 1,
    onUpdate: (value) => {
      element.scrollLeft = value;
    },
  });
  return () => animation.stop();
}
