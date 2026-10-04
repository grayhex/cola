import { rideOccurrence } from "./ride-occurrence.ts";

// Used by the in-app list/count and by email immediately before each attempt.
// Aliases are those of notifications.ts. No names, geometry or recipients snapshot.
export function rideNoticeVisible(clock = "now()") {
  const occurrence = rideOccurrence.replaceAll("now()", `(${clock})`);
  const access = `NOT ro.blocked AND (r.owner_id=n.recipient_id OR (r.is_public AND rb.is_public) OR EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=n.recipient_id))`;
  const answer = `SELECT 1 FROM ride_rsvps v WHERE v.ride_id=r.id AND v.user_id=n.recipient_id AND v.occurs_at=n.event_occurs_at`;
  const current = `r.status='planned' AND n.event_occurs_at>${clock} AND n.event_occurs_at=(${occurrence}) AND n.event_revision=r.agreement_revision`;
  return `(${access} AND n.cancelled_at IS NULL AND n.deliver_after<=${clock} AND (
    (n.type='ride_invite' AND EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=n.recipient_id)
      AND (NOT EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=n.recipient_id AND i.source='interest') OR EXISTS(SELECT 1 FROM ride_intents intent JOIN ride_intent_windows w ON w.intent_id=intent.id WHERE intent.owner_id=n.recipient_id AND intent.status='active' AND intent.visibility='community' AND intent.allow_suggestions AND w.ends_at>${clock}))
      AND ((n.event_occurs_at IS NULL AND r.status='planned' AND (${occurrence})>${clock}
        AND NOT EXISTS(SELECT 1 FROM ride_rsvps v WHERE v.ride_id=r.id AND v.user_id=n.recipient_id AND v.occurs_at=(${occurrence}))) OR (${current} AND NOT EXISTS(${answer}))))
    OR (n.type='ride_changed' AND ${current} AND (EXISTS(${answer} AND v.response IN ('accepted','maybe')) OR EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=n.recipient_id)) AND NOT EXISTS(${answer} AND v.response='declined'))
    OR (n.type='ride_response' AND ${current} AND r.owner_id=n.recipient_id AND EXISTS(SELECT 1 FROM ride_rsvps v JOIN users responder ON responder.id=v.user_id WHERE v.ride_id=r.id AND v.occurs_at=n.event_occurs_at AND v.revision=n.event_revision AND NOT responder.blocked))
    OR (n.type='ride_reminder' AND ${current} AND n.event_occurs_at>${clock}+interval '5 minutes'
      AND coalesce((SELECT s.reminders FROM notification_settings s WHERE s.user_id=n.recipient_id),true)
      AND EXISTS(${answer} AND v.response='accepted' AND v.revision=n.event_revision))
    OR (n.type='ride_cancelled' AND n.created_at>${clock}-interval '14 days'
      AND (r.status='cancelled' OR EXISTS(SELECT 1 FROM ride_cancelled_occurrences c WHERE c.ride_id=r.id AND c.occurs_on=(n.event_occurs_at AT TIME ZONE r.recurrence_timezone)::date))
      AND (EXISTS(${answer} AND v.response IN ('accepted','maybe')) OR (EXISTS(SELECT 1 FROM ride_invitations i WHERE i.ride_id=r.id AND i.user_id=n.recipient_id) AND NOT EXISTS(${answer} AND v.response='declined'))))
  ))`;
}
