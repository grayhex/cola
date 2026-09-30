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
/** The viewer's answer to the current date (#235). One state from the API:
 * an answer to an earlier edition is shown as "confirm again", never as a
 * pressed button. A failed request rolls the buttons back and says why. */
export default function RideRsvp({ ride, onResponse, compact = false }) {
  const { viewer } = useSite();
  const [state, setState] = useState(ride),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const sequence = useRef(0);
  useEffect(() => setState(ride), [ride]);
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
    if (busy || state.rsvp === response) return;
    const before = state,
      request = ++sequence.current;
    setBusy(true);
    setError("");
    setStatus("");
    // The buttons follow at once; the server's answer replaces them.
    setState((v) => ({
      ...v,
      rsvp: response,
      participation: response,
      previousRsvp: null,
      rsvpCounts: shifted(
        v.rsvpCounts || {},
        v.participation === "reconfirm" ? "reconfirm" : v.rsvp,
        response,
      ),
    }));
    try {
      const next = await socialApi("rides/" + ride.id + "/rsvp", "PATCH", {
        response,
        occurrenceAt: new Date(ride.scheduledAt).toISOString(),
      });
      if (request !== sequence.current) return;
      setState((v) => ({ ...v, ...next }));
      setStatus("Ответ сохранён: " + responseLabels[response]);
      await onResponse?.(next);
    } catch (e) {
      if (request !== sequence.current) return;
      setState(before);
      setError(e.message);
    } finally {
      if (request === sequence.current) setBusy(false);
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
