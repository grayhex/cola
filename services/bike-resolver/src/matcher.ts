import { normalize } from "./normalize.js";
import type { BikeCandidate, BikeQuery } from "./domain.js";
const squash = (s: string) => s.replace(/\s+/g, "");
// The model, written without spaces, equals a run of the name's own words.
export function joinedRun(model: string, actual: string) {
  const target = squash(model),
    words = actual.split(" ").filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    let joined = "";
    for (let j = i; j < words.length && joined.length < target.length; j++) {
      joined += words[j];
      if (joined === target) return true;
    }
  }
  return false;
}
// Normalized model words are all among the name's words, or are the same
// words run together ("BlackLava" for "Black Lava", "Dont" for "Don't").
export function modelWordsMatch(model: string, actual: string) {
  const words = new Set(actual.split(" "));
  return (
    model.split(" ").every((t) => words.has(t)) || joinedRun(model, actual)
  );
}
export const MATCH_THRESHOLD = 0.95;
export const MATCH_MARGIN = 0.06;
export const EXPLICIT_MATCH_THRESHOLD = 0.88;
export function scoreCandidate(q: BikeQuery, c: BikeCandidate): number {
  if (
    normalize(q.brand) !== normalize(c.brand) ||
    (q.year !== null && c.year !== null && q.year !== c.year)
  )
    return 0;
  const strip = (s: string) => {
    const normalized = normalize(s),
      prefix = normalize(q.brand) + " ";
    return (
      normalized.startsWith(prefix)
        ? normalized.slice(prefix.length)
        : normalized
    )
      .replace(/\b(?:19|20)\d{2}\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  };
  const actual = strip(c.canonicalName),
    model = normalize(q.model),
    wanted = normalize([q.model, q.trim].filter(Boolean).join(" "));
  const words = new Set(actual.split(" ")),
    wantedWords = wanted.split(" ");
  // "BlackLava 2" and "Black Lava 2" are one model: when the words differ only
  // by spaces, the whole name (not a fragment of it) decides.
  const spaced = squash(wanted) === squash(actual);
  if (!spaced && !model.split(" ").every((t) => words.has(t))) {
    if (q.trim || !joinedRun(model, actual)) return 0;
  } else if (
    !spaced &&
    q.trim &&
    (!wantedWords.every((t) => words.has(t)) ||
      [...words].some((t) => !wantedWords.includes(t)))
  )
    return 0;
  const exact =
    spaced ||
    (words.size === new Set(wantedWords).size &&
      wantedWords.every((t) => words.has(t)));
  return (
    Math.round(
      ((q.year === null ? 0.6 : c.year === q.year ? 0.7 : 0.35) +
        (exact ? 0.29 : 0.18)) *
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
export function partialScore(
  query: BikeQuery,
  name: string,
  year: number | null,
): number {
  const text = normalize(name),
    words = new Set(text.split(" "));
  if (
    !normalize(query.brand)
      .split(" ")
      .every((w) => words.has(w))
  )
    return 0;
  const model = normalize(query.model).split(" ").filter(Boolean);
  const matches = model.filter((w) => words.has(w)).length;
  if (!matches || matches / model.length < 0.5) return 0;
  const trim = normalize(query.trim || "")
    .split(" ")
    .filter(Boolean);
  return (
    (matches / model.length) * 0.65 +
    (year === query.year ? 0.2 : 0) +
    (trim.length
      ? (trim.filter((w) => words.has(w)).length / trim.length) * 0.15
      : 0.1)
  );
}
