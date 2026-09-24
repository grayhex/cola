"use client";
import { useEffect, useState } from "react";
import { socialApi } from "./social-primitives.jsx";
import SiteIcon from "./site-icon.jsx";
const choices = [
  ["accepted", "yes", "Иду"],
  ["declined", "no", "Не иду"],
  ["maybe", "maybe", "Может быть"],
];
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
export default function RideRsvp({ ride }) {
  const [state, setState] = useState(ride),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => setState(ride), [ride]);
  if (
    ride.status !== "planned" ||
    !ride.scheduledAt ||
    new Date(ride.scheduledAt) <= new Date()
  )
    return null;
  return (
    <div className="ride-rsvp">
      <div role="group" aria-label="Участие в покатушке">
        {choices.map(([response, icon, label]) => (
          <button
            key={response}
            type="button"
            className="hf-button"
            aria-pressed={state.rsvp === response}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const next = await socialApi(
                  "rides/" + ride.id + "/rsvp",
                  "PATCH",
                  {
                    response,
                    occurrenceAt: new Date(ride.scheduledAt).toISOString(),
                  },
                );
                setState((v) => ({ ...v, ...next }));
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <SiteIcon name={icon} />
            {label}
            <span className="rsvp-count">
              {state.rsvpCounts?.[response] || 0}
            </span>
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
