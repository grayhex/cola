"use client";
import { useEffect, useState } from "react";
import { IntentComposer, intentDraft } from "./ride-intents.jsx";
import { socialApi } from "./social-primitives.jsx";
import { useSite } from "./site-provider.jsx";
import { userTimeZone } from "../../lib/user-time-zone.js";
export { default as PlanComposer } from "./plan-composer.jsx";

// Loaded on the first «Хочу кататься» / «Организовать покатушку» click
// (#245): the composers of /ride-intents and the ride planner themselves, not
// copies with their own state.
export function IntentDialog({ onClose, onSaved }) {
  const { personalSettings } = useSite();
  // New intents use the profile's zone (#253).
  const [draft] = useState(() =>
      intentDraft("weekend", null, false, userTimeZone(personalSettings)),
    ),
    [preferences, setPreferences] = useState({ passport: {} });
  useEffect(() => {
    let active = true;
    // Saved preferences only prefill «Использовать настройки»; the form
    // works without them.
    socialApi("ride-intents/preferences")
      .then((result) => {
        if (active) setPreferences(result.preferences);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return (
    <IntentComposer
      initial={draft}
      preferences={preferences}
      onPreferences={setPreferences}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
