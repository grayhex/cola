-- Bounded candidate scans for explainable matching (#232). Indexes only.
CREATE INDEX rides_planned_once ON rides(started_at,id) WHERE status='planned' AND recurrence='none';
CREATE INDEX rides_planned_weekly ON rides(started_at,id) WHERE status='planned' AND recurrence='weekly';
CREATE INDEX ride_intent_windows_start ON ride_intent_windows(starts_at,intent_id);
CREATE INDEX ride_rsvps_user_occurrence ON ride_rsvps(user_id,ride_id,occurs_at);
