"use client";
import { useRef } from "react";

// A press on a modal <dialog>'s backdrop, outside its box. Clicks on the
// window's own padding and scrollbar also target the <dialog> element, and
// so does a click whose press started elsewhere: a text selection dragged
// out of a field, or the click a tap sends after a suggestion list under
// the finger has gone.
function outside(event) {
  const box = event.currentTarget.getBoundingClientRect();
  return (
    event.target === event.currentTarget &&
    (event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom)
  );
}

/**
 * Handlers for a modal <dialog> that closes from its backdrop: only a press
 * that both starts and ends outside the window closes it (#129).
 */
export function useBackdropClose(onClose) {
  const pressed = useRef(false);
  return {
    onPointerDown(event) {
      pressed.current = outside(event);
    },
    onClick(event) {
      const started = pressed.current;
      pressed.current = false;
      if (started && outside(event)) onClose();
    },
  };
}
