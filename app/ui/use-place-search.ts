"use client";
import type { Place } from "../../lib/geocoding.ts";
import { useEffect, useState } from "react";

// The place search of the area field (#370): the words typed go to the site's
// own /api/geocode after a short pause, one request at a time, and an answer
// that comes late for words that are no longer typed is dropped.
export type PlaceSearch = {
  status: "idle" | "loading" | "found" | "empty" | "error";
  places: Place[];
  message: string;
};
const idle: PlaceSearch = { status: "idle", places: [], message: "" };
const pause = 350,
  shortest = 2;

export function usePlaceSearch(query: string, enabled = true): PlaceSearch {
  const [state, setState] = useState<PlaceSearch>(idle);
  // A service that is not configured is not asked again on every key.
  const [off, setOff] = useState("");
  const words = query.replace(/\s+/g, " ").trim();
  useEffect(() => {
    if (!enabled || words.length < shortest) {
      setState(idle);
      return;
    }
    if (off) {
      setState({ status: "error", places: [], message: off });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, status: "loading", message: "" }));
      try {
        const response = await fetch(
          "/api/geocode?" + new URLSearchParams({ q: words }),
          { cache: "no-store", signal: controller.signal },
        );
        const body: { places?: Place[]; error?: string } = await response
          .json()
          .catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) {
          const message =
            body.error ||
            "Поиск мест сейчас недоступен. Назовите область сами.";
          if (response.status === 503) setOff(message);
          setState({ status: "error", places: [], message });
          return;
        }
        const places = body.places || [];
        setState({
          status: places.length ? "found" : "empty",
          places,
          message: "",
        });
      } catch {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          places: [],
          message: "Поиск мест сейчас недоступен. Назовите область сами.",
        });
      }
    }, pause);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [words, enabled, off]);
  return state;
}
