import { normalize } from "./normalize.js";
import type { BikeQuery } from "./domain.js";
// Missing year is uncertainty; a stated different year is a conflict.
export function identityConflict(
  query: BikeQuery,
  name: string,
  year: number | null,
) {
  const actual = new Set(normalize(name).split(" "));
  const wanted = normalize(
    [query.brand, query.model, query.trim].filter(Boolean).join(" "),
  ).split(" ");
  return (
    (query.year !== null && year !== null && year !== query.year) ||
    (actual.size > 1 && !wanted.every((t) => actual.has(t)))
  );
}
