import { normalize } from "./normalize.js";
import type { BikeCandidate, BikeQuery } from "./domain.js";
export const MATCH_THRESHOLD = 0.95;
export const MATCH_MARGIN = 0.06;
export const EXPLICIT_MATCH_THRESHOLD = 0.88;
export function scoreCandidate(q: BikeQuery, c: BikeCandidate): number {
  if (
    normalize(q.brand) !== normalize(c.brand) ||
    (c.year !== null && q.year !== c.year)
  )
    return 0;
  const strip = (s: string) =>
    normalize(s)
      .replace(new RegExp("^" + normalize(q.brand) + "\\s+"), "")
      .replace(/\b(?:19|20)\d{2}\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const actual = strip(c.canonicalName),
    model = normalize(q.model),
    wanted = normalize([q.model, q.trim].filter(Boolean).join(" "));
  if (actual !== model && !actual.startsWith(model + " ")) return 0;
  if (q.trim && actual !== wanted) return 0;
  return (
    Math.round(
      ((c.year === q.year ? 0.7 : 0.35) + (actual === wanted ? 0.29 : 0.18)) *
        100,
    ) / 100
  );
}
export function match(q: BikeQuery, candidates: BikeCandidate[]) {
  const ranked = [...new Map(candidates.map((c) => [c.url, c])).values()]
    .map((c) => ({ ...c, score: scoreCandidate(q, c) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  const top = ranked[0];
  const ambiguous =
    !top ||
    top.score < MATCH_THRESHOLD ||
    (!!ranked[1] && top.score - ranked[1].score < MATCH_MARGIN) ||
    (q.trim === null && ranked.length > 1);
  return { ranked, chosen: ambiguous ? null : top };
}
