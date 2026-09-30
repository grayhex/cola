// #235: the agreement of a planned ride. What counts as a new edition of its
// conditions, and the one participation state a person has for the current
// date. Pure functions: the server decides with them, tests pin them down.

export type AgreementAspect = "start" | "place" | "route";
export type Participation =
  | "organizer"
  | "accepted"
  | "maybe"
  | "declined"
  | "reconfirm"
  | "invited"
  | "none";

export const agreementAspects = Object.freeze([
  "start",
  "place",
  "route",
] as AgreementAspect[]);

/** Formatting that never changes a place: case, ё, punctuation, quotes and
spacing. */
export function normalizePlace(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Exactly one inserted, deleted or replaced letter, or two neighbours
swapped. */
function oneSlip(a: string, b: string) {
  if (a === b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.length - short.length > 1) return false;
  if (long.length > short.length) {
    let i = 0;
    while (i < short.length && short[i] === long[i]) i++;
    return short.slice(i) === long.slice(i + 1);
  }
  const diff = [];
  for (let i = 0; i < short.length && diff.length < 3; i++)
    if (short[i] !== long[i]) diff.push(i);
  if (diff.length === 1) return true;
  const [i, j] = diff;
  return (
    diff.length === 2 &&
    j === i + 1 &&
    short[i] === long[j] &&
    short[j] === long[i]
  );
}

/** A new meeting place, or a corrected typo? Deliberately strict: only
formatting, a lost or extra space, or one slip in one word of five or more
letters keeps the answers. Numbers (house, exit, gate) never change
silently, and adding or removing a place is a change. */
export function placeChanged(before: unknown, after: unknown) {
  const a = normalizePlace(before),
    b = normalizePlace(after);
  if (a === b) return false;
  if (!a || !b) return true;
  const digits = (s: string) => s.replace(/\D+/g, " ").trim();
  if (digits(a) !== digits(b)) return true;
  if (a.replaceAll(" ", "") === b.replaceAll(" ", "")) return false;
  const x = a.split(" "),
    y = b.split(" ");
  if (x.length !== y.length) return true;
  const differ = x.flatMap((word, i) => (word === y[i] ? [] : [[word, y[i]]]));
  if (differ.length !== 1) return true;
  const [p, q] = differ[0];
  return Math.min(p.length, q.length) < 5 || !oneSlip(p, q);
}

/** Great-circle distance between two [lon, lat] points, km. */
function distanceKm(a: number[], b: number[]) {
  const rad = Math.PI / 180,
    dLat = (b[1] - a[1]) * rad,
    dLon = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The approximate area moved: another name (beyond a typo) or a centre more
than 3 km away. Adding, removing or resizing the area is not a new place. */
export function areaChanged(
  before: { label?: string; center?: number[] } | null | undefined,
  after: { label?: string; center?: number[] } | null | undefined,
) {
  if (!before?.label || !after?.label) return false;
  if (placeChanged(before.label, after.label)) return true;
  return (
    !!before.center &&
    !!after.center &&
    distanceKm(before.center, after.center) > 3
  );
}

export type AgreementTerms = {
  occursAt: string | Date | null | undefined;
  meetingPoint?: string | null;
  area?: { label?: string; center?: number[] } | null;
  hasTrack?: boolean;
};

/** Aspects of the agreement that changed substantially between two
editions of a plan. An empty list means the answers stay valid: a title,
description, format or typo edit is not a new agreement. */
export function agreementChanges(
  before: AgreementTerms,
  after: AgreementTerms,
): AgreementAspect[] {
  const changes: AgreementAspect[] = [];
  if (
    before.occursAt &&
    after.occursAt &&
    +new Date(before.occursAt) !== +new Date(after.occursAt)
  )
    changes.push("start");
  if (
    placeChanged(before.meetingPoint, after.meetingPoint) ||
    areaChanged(before.area, after.area)
  )
    changes.push("place");
  if (!before.hasTrack && after.hasTrack) changes.push("route");
  return changes;
}

/** The one participation state of a person for the current date. An answer
to an earlier edition is not agreement with this one ("reconfirm"), except
a refusal, which stays a refusal. */
export function participationState({
  owner = false,
  invited = false,
  response = null,
  revision = null,
  agreementRevision = 1,
}: {
  owner?: boolean;
  invited?: boolean;
  response?: string | null;
  revision?: number | null;
  agreementRevision?: number;
}): Participation {
  if (owner) return "organizer";
  if (response === "declined") return "declined";
  if (response && (revision ?? 1) < agreementRevision) return "reconfirm";
  if (response === "accepted" || response === "maybe") return response;
  return invited ? "invited" : "none";
}

/** May this person answer "going" or "maybe" now? A closed recruitment stops
new people only: invited people and those who already said "going" or
"maybe" (even to an earlier edition) keep their place. */
export function mayJoin(
  state: Participation,
  {
    invited = false,
    recruitmentClosed = false,
  }: { invited?: boolean; recruitmentClosed?: boolean },
) {
  if (state === "organizer") return false;
  if (!recruitmentClosed) return true;
  return invited || ["accepted", "maybe", "reconfirm"].includes(state);
}
