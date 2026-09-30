import {
  localDateTime,
  localInstants,
  resolveLocal,
} from "./ride-intent-time.ts";

// The planner's wall-clock fields → the plan API (#253). Pure, so the fold
// and next-day rules are tested without a browser.

const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86400000)
    .toISOString()
    .slice(0, 10);

/** Local start and end; an end time not after the start time is on the next
day. Compared as wall-clock strings, so a DST fold cannot flip the order. */
export function planLocalTimes({
  date,
  time,
  endTime,
}: {
  date: string;
  time: string;
  endTime?: string;
}) {
  if (!date || !time) return { start: "", end: "" };
  return {
    start: `${date}T${time}`,
    end: endTime ? `${endTime <= time ? nextDay(date) : date}T${endTime}` : "",
  };
}

/** Instants of a local time, or none while the value is incomplete. */
export function foldChoices(local: string, zone: string) {
  try {
    return local ? localInstants(local, zone) : [];
  } catch {
    return [];
  }
}

/** Start and optional end as ISO instants in `zone`. A time that repeats
when clocks go back needs `startFold` / `endFold` ("earlier" | "later");
without it `resolveLocal` asks for one. */
export function planInstants(
  form: {
    date: string;
    time: string;
    endTime?: string;
    startFold?: string;
    endFold?: string;
  },
  zone: string,
) {
  const { start, end } = planLocalTimes(form);
  const scheduledAt = resolveLocal(start, zone, form.startFold);
  if (!end) return { scheduledAt, expectedEndAt: null };
  const expectedEndAt = resolveLocal(end, zone, form.endFold);
  if (Date.parse(expectedEndAt) <= Date.parse(scheduledAt))
    throw new Error("Окончание должно быть позже старта.");
  return { scheduledAt, expectedEndAt };
}

/** The fold of a saved instant, so editing keeps the chosen occurrence. */
export function foldOf(
  instant: string | Date | null | undefined,
  zone: string,
) {
  if (!instant) return undefined;
  const choices = foldChoices(localDateTime(instant, zone), zone);
  if (choices.length < 2) return undefined;
  return choices[0] === new Date(instant).toISOString() ? "earlier" : "later";
}

/** Track-edge protection of a plan. The planner has no control for it: a
meeting point for participants turns it on (the server enforces the same),
a public one turns off what the server forced for a hidden point, and a
protection the organiser chose earlier with a public point is kept. */
export function planPrivacy(
  ride: { privacyEnabled: boolean; meetingVisibility?: string } | null,
  meetingVisibility: string,
) {
  if (meetingVisibility === "participants") return true;
  return !!ride?.privacyEnabled && ride.meetingVisibility !== "participants";
}
