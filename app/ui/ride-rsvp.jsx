"use client";
import { useEffect, useRef, useState } from "react";
import { socialApi } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import { useMotionFeedback } from "./motion.jsx";
import SiteIcon from "./site-icon.jsx";
const choices = [
  ["accepted", "yes", "Иду"],
  ["maybe", "maybe", "Может быть"],
  ["declined", "no", "Не иду"],
];
export const responseLabels = {
  accepted: "Иду",
  maybe: "Может быть",
  declined: "Не иду",
};
export function RecurringRideLabel({ ride }) {
  if (ride.recurrence !== "weekly") return null;
  const day = new Date(ride.scheduledAt).toLocaleDateString("ru-RU", {
    weekday: "long",
    timeZone: ride.recurrenceTimezone,
  });
  const time = new Date(ride.scheduledAt).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ride.recurrenceTimezone,
  });
  return (
    <p className="help recurrence-label">
      <SiteIcon name="repeat" /> Каждую неделю · {day}, {time} ·{" "}
      {ride.recurrenceTimezone}
    </p>
  );
}
/** Counts after a change of one person's answer, before the server confirms. */
function shifted(counts, from, to) {
  const next = { ...counts };
  if (from && next[from]) next[from] -= 1;
  next[to] = (next[to] || 0) + 1;
  return next;
}
/** The buttons at once, before the server answers. */
const chosen = (v, response) => ({
  ...v,
  rsvp: response,
  participation: response,
  previousRsvp: null,
  rsvpCounts: shifted(
    v.rsvpCounts || {},
    v.participation === "reconfirm" ? "reconfirm" : v.rsvp,
    response,
  ),
});
/** The viewer's answer to the current date (#235). One state from the API:
 * an answer to an earlier edition is shown as "confirm again", never as a
 * pressed button. Answers go one at a time and the latest press wins: a
 * press during a request is sent right after it. A failed request rolls the
 * buttons back to the last saved answer and says why. */
export default function RideRsvp({ ride, onResponse, compact = false }) {
  const { viewer } = useSite();
  const [state, setState] = useState(ride),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const running = useRef(false),
    queued = useRef(null);
  // A refresh read before the last press must not flip the buttons back.
  useEffect(() => {
    if (!running.current) setState(ride);
  }, [ride]);
  const feedback = useMotionFeedback(state.rsvp);
  if (
    ride.status !== "planned" ||
    !ride.scheduledAt ||
    new Date(ride.scheduledAt) <= new Date() ||
    !viewer ||
    ride.participation === "organizer" ||
    ride.isOwner
  )
    return null;
  async function answer(response) {
    setError("");
    setStatus("");
    if (running.current) {
      queued.current = response;
      setState((v) => (v.rsvp === response ? v : chosen(v, response)));
      return;
    }
    if (state.rsvp === response) return;
    running.current = true;
    setBusy(true);
    setState((v) => chosen(v, response));
    let saved = state,
      last = null,
      failed = false,
      choice = response;
    while (choice) {
      try {
        last = await socialApi("rides/" + ride.id + "/rsvp", "PATCH", {
          response: choice,
          occurrenceAt: new Date(ride.scheduledAt).toISOString(),
        });
        saved = { ...saved, ...last };
      } catch (e) {
        failed = true;
        setError(e.message);
        break;
      }
      choice = queued.current !== last.rsvp ? queued.current : null;
      queued.current = null;
    }
    queued.current = null;
    running.current = false;
    setBusy(false);
    // The last saved answer, never a press the server refused.
    setState(saved);
    if (last) {
      if (!failed) setStatus("Ответ сохранён: " + responseLabels[last.rsvp]);
      // The page refreshes what depends on the answer (the meeting place);
      // the buttons do not wait for it.
      void onResponse?.(last);
    }
  }
  return (
    <div className="ride-rsvp" data-compact={compact || undefined}>
      <div
        role="group"
        aria-label="Участие в покатушке"
        aria-busy={busy || undefined}
      >
        {choices.map(([response, icon, label]) => {
          const closed = response !== "declined" && !state.canJoin;
          const pressed = state.rsvp === response;
          return (
            <button
              key={response}
              type="button"
              className="button secondary"
              aria-pressed={pressed}
              data-previous={
                state.previousRsvp === response ? "true" : undefined
              }
              // Busy buttons stay enabled so keyboard focus is not lost;
              // a second press while saving is ignored in answer().
              disabled={closed && !pressed}
              title={
                closed && !pressed
                  ? "Организатор закрыл набор на эту дату"
                  : undefined
              }
              onClick={() => answer(response)}
            >
              <span ref={pressed ? feedback : undefined} className="rsvp-icon">
                <SiteIcon name={icon} />
              </span>
              {label}
              <span className="rsvp-count">
                {state.rsvpCounts?.[response] || 0}
              </span>
            </button>
          );
        })}
      </div>
      {!compact && state.rsvpCounts?.reconfirm > 0 && (
        <p className="help">
          Ещё не подтвердили новые условия: {state.rsvpCounts.reconfirm}
        </p>
      )}
      <span className="sr-only" role="status">
        {status}
      </span>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
