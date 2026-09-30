import { ridePlanOptions } from "./ride-plan-options.js";

// #235: the public announcement of a planned ride — what a guest, a search
// engine and a messenger preview may read: date and time in the ride's own
// zone, format, approximate area and organizer. Never the meeting place,
// participants, invitations, private route points or anyone's intent.

/** "сб, 3 октября в 10:00 GMT+3": the agreed time in the ride's zone, with
 * its offset, so nobody converts it in their head.
 * @param {string|Date|null|undefined} value @param {string} [timeZone] */
export function rideTimeLabel(value, timeZone = "Europe/Moscow") {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleString("ru-RU", {
      weekday: "short",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    });
  } catch {
    return date.toLocaleString("ru-RU", {
      weekday: "short",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    });
  }
}

/** Purpose, pace and surface as one short line.
 * @param {{purpose?: string, pace?: string, surface?: string}} [passport] */
export function rideFormatLabel(passport = {}) {
  const pick = (/** @type {"purpose"|"pace"|"surface"} */ key) =>
    passport[key]
      ? /** @type {Record<string, string>} */ (ridePlanOptions[key])[
          passport[key]
        ] || ""
      : "";
  const pace = pick("pace");
  return [
    pick("purpose"),
    pace && pace.toLowerCase() + " темп",
    pick("surface"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * @typedef {object} AnnouncementInput
 * @property {string} status planned | cancelled | completed
 * @property {string|Date|null} [occursAt] the current date
 * @property {string} [timeZone]
 * @property {string} [recurrence]
 * @property {{purpose?: string, pace?: string, surface?: string, area?: {label?: string}}} [passport]
 * @property {string|null} [organizer] the organizer's public name
 * @property {boolean} [recruitmentClosed]
 */

/** One line for Open Graph and the page head. @param {AnnouncementInput} ride */
export function rideAnnouncement(ride) {
  const organizer = ride.organizer ? "организатор: " + ride.organizer : "";
  if (ride.status === "cancelled")
    return ["Покатушка отменена", organizer].filter(Boolean).join(" · ");
  const passport = ride.passport || {};
  return [
    rideTimeLabel(ride.occursAt, ride.timeZone),
    ride.recurrence === "weekly" ? "каждую неделю" : "",
    rideFormatLabel(passport),
    passport.area?.label ? "район: " + passport.area.label : "",
    organizer,
    ride.recruitmentClosed ? "набор закрыт" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
