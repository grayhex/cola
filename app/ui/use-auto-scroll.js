"use client";
import { useEffect } from "react";
import { frame, cancelFrame } from "motion";
import { useReducedMotion } from "./motion.jsx";

// Both home rails use pixels/second, independent of card or headline length.
export function useAutoScroll(ref, { speed, paused, loop = false }) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const node = ref.current;
    if (!node || reduced || paused) return;
    let visible = false,
      hovering = node.matches(":hover"),
      focused = node.contains(document.activeElement);
    let position = node.scrollLeft,
      direction = 1;
    const observe = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    observe.observe(node);
    const enter = () => {
      hovering = true;
    };
    const leave = () => {
      hovering = false;
      position = node.scrollLeft;
    };
    const focus = () => {
      focused = true;
    };
    const blur = (event) => {
      focused = node.contains(event.relatedTarget);
      position = node.scrollLeft;
    };
    const tick = ({ delta }) => {
      if (!visible || hovering || focused || document.hidden) return;
      const max = node.scrollWidth - node.clientWidth;
      if (max < 1) return;
      position += (direction * speed * Math.min(delta, 40)) / 1000;
      const end = loop ? node.firstElementChild.scrollWidth / 2 : max;
      if (loop && end > max) return;
      if (loop && position >= end) position -= end;
      if (!loop && (position >= max || position <= 0)) {
        position = Math.max(0, Math.min(max, position));
        direction *= -1;
      }
      node.scrollLeft = position;
    };
    node.addEventListener("pointerenter", enter);
    node.addEventListener("pointerleave", leave);
    node.addEventListener("focusin", focus);
    node.addEventListener("focusout", blur);
    frame.update(tick, true);
    return () => {
      cancelFrame(tick);
      observe.disconnect();
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointerleave", leave);
      node.removeEventListener("focusin", focus);
      node.removeEventListener("focusout", blur);
    };
  }, [ref, speed, paused, loop, reduced]);
}
