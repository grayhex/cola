// The current date of a plan, in SQL over a `rides r` row. One formula for
// RSVP, lists, matching, the organizer's tools and public previews.

// Calendar weeks, not 168 elapsed hours: keep the local start time across DST.
const firstWeek = `greatest(0,ceil(extract(epoch FROM ((now() AT TIME ZONE r.recurrence_timezone) - (r.started_at AT TIME ZONE r.recurrence_timezone)))/604800)::int)`;
const weekly = (/** @type {string} */ k) =>
  `((r.started_at AT TIME ZONE r.recurrence_timezone) + (${k}) * interval '7 days') AT TIME ZONE r.recurrence_timezone`;
/** Future cancelled dates a series may hold (#235); the next date is always
 * found among this many + 1 weeks. */
export const maxCancelledOccurrences = 20;
// A cancelled date of a series is skipped (#235); only a series that has one
// ahead pays for the search.
export const rideOccurrence = `CASE WHEN r.status='planned' AND r.recurrence='weekly' THEN
 CASE WHEN EXISTS(SELECT 1 FROM ride_cancelled_occurrences c WHERE c.ride_id=r.id AND c.occurs_on>=(now() AT TIME ZONE r.recurrence_timezone)::date) THEN
  (SELECT x.o FROM generate_series(0,${maxCancelledOccurrences}) s, LATERAL (SELECT ${weekly(firstWeek + "+s")} AS o) x
   WHERE NOT EXISTS(SELECT 1 FROM ride_cancelled_occurrences c WHERE c.ride_id=r.id AND c.occurs_on=(x.o AT TIME ZONE r.recurrence_timezone)::date)
   ORDER BY s LIMIT 1)
 ELSE ${weekly(firstWeek)} END
 ELSE r.started_at END`;
