"use client";
import { useHydrated } from "./use-hydrated.js";
// The server renders a date in Moscow time, the site's default zone; the
// viewer's own zone applies right after hydration, so the markup matches.
export default function LocalDate({ value, time = false, options = {} }) {
  const hydrated = useHydrated();
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  const format = {
    ...options,
    ...(hydrated ? {} : { timeZone: "Europe/Moscow" }),
  };
  return (
    <time dateTime={date.toISOString()}>
      {time
        ? date.toLocaleString("ru-RU", format)
        : date.toLocaleDateString("ru-RU", format)}
    </time>
  );
}
