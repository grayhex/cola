import { validTimeZone } from "./ride-intent-time.js";

/** The rider's zone for new intents and planned rides (#253): the profile
setting when saved, else the browser's own zone. */
export function userTimeZone(
  settings:
    | {
        timeZone?: string;
      }
    | null
    | undefined,
) {
  if (validTimeZone(settings?.timeZone))
    return /** @type {string} */ settings?.timeZone as string;
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return validTimeZone(browser) ? browser : "UTC";
}
/** IANA zones for the profile picker; a short list where the runtime has none. */
export function timeZoneChoices() {
  const intl = Intl;
  try {
    if (typeof intl.supportedValuesOf === "function")
      return intl.supportedValuesOf("timeZone");
  } catch {
    /* Fall back to the bundled zone list. */
  }
  return [
    "Europe/Moscow",
    "Europe/Kaliningrad",
    "Asia/Yekaterinburg",
    "Asia/Novosibirsk",
    "Asia/Vladivostok",
    "Europe/Berlin",
    "UTC",
  ];
}
