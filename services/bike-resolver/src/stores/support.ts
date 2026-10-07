import type { BikeQuery } from "../domain.js";
import { normalize } from "../normalize.js";
import { partialScore } from "../matcher.js";

// Ranks product slugs of a store's public catalogue against the query. The slug
// is only a pointer: the verified page decides identity and year.
export function rankSlugs<T extends { slug: string }>(
  query: BikeQuery,
  entries: T[],
  limit: number,
): T[] {
  return entries
    .map((entry) => {
      const text = normalize(entry.slug.replace(/[-_]+/g, " "));
      const year = text.match(/\b(?:19|20)\d{2}\b/g)?.at(-1);
      return {
        entry,
        score: partialScore(query, text, year ? Number(year) : query.year),
      };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.entry.slug.length - b.entry.slug.length,
    )
    .slice(0, limit)
    .map((x) => x.entry);
}
