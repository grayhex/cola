import { ridePlanOptions } from "./ride-plan-options.ts";

// #235: the public announcement of a planned ride — what a guest, a search
// engine and a messenger preview may read: date and time in the ride's own
// zone, format, approximate area and organizer. Never the meeting place,
// participants, invitations, private route points or anyone's intent.

/** "сб, 3 октября в 10:00 GMT+3": the agreed time in the ride's zone, with
its offset, so nobody converts it in their head. */
export function rideTimeLabel(
  value: string | Date | null | undefined,
  timeZone: string = "Europe/Moscow",
) {
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

/** Purpose, pace and surface as one short line. */
export function rideFormatLabel(
  passport: { purpose?: string; pace?: string; surface?: string } = {},
) {
  const pick = (key: "purpose" | "pace" | "surface") =>
    passport[key]
      ? (ridePlanOptions[key] as Record<string, string>)[passport[key]] || ""
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

export interface AnnouncementInput {
  status: string;
  occursAt?: string | Date | null;
  timeZone?: string;
  recurrence?: string;
  passport?: {
    purpose?: string;
    pace?: string;
    surface?: string;
    area?: { label?: string };
  };
  organizer?: string | null;
  recruitmentClosed?: boolean;
}

/** One line for Open Graph and the page head. */
export function rideAnnouncement(ride: AnnouncementInput) {
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
