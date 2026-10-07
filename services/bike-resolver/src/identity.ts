import { normalize } from "./normalize.js";
import { requestInName } from "./matcher.js";
import type { BikeQuery } from "./domain.js";
// Missing year is uncertainty; a stated different year is a conflict.
export function identityConflict(
  query: BikeQuery,
  name: string,
  year: number | null,
) {
  const actual = new Set(normalize(name).split(" "));
  return (
    (query.year !== null && year !== null && year !== query.year) ||
    (actual.size > 1 && !requestInName(query, name))
  );
}
