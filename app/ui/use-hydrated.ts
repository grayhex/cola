"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
// False while React hydrates the server HTML, true afterwards and on client
// renders. Anything that depends on the viewer's clock, time zone or screen
// waits for it, so the first client render matches the server (#74).
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
