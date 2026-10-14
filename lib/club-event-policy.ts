import {
  clubRideEnvelopeSql,
  internalClubRideSql,
} from "./club-ride-access.ts";
export const clubEventTypes = [
  "club_application",
  "club_invitation",
  "club_membership_result",
  "club_role",
  "club_organizer_lost",
  "club_ride_new",
] as const;
export function clubEventVisible(clock = "now()") {
  const currentAdmin = `EXISTS(SELECT 1 FROM club_memberships admin JOIN users au ON au.id=admin.user_id AND NOT au.blocked WHERE admin.club_id=cl.id AND admin.user_id=n.recipient_id AND admin.state='active' AND admin.role IN ('owner','admin'))`;
  const currentTarget = `EXISTS(SELECT 1 FROM club_memberships target JOIN users tu ON tu.id=target.user_id WHERE target.club_id=cl.id AND target.user_id=ce.target_id AND NOT tu.blocked AND target.revision=ce.revision AND target.state=ce.target_state)`;
  const currentMember = `EXISTS(SELECT 1 FROM club_memberships member JOIN users mu ON mu.id=member.user_id WHERE member.club_id=cl.id AND member.user_id=n.recipient_id AND member.state='active' AND NOT mu.blocked)`;
  return `(n.club_event_id IS NOT NULL AND cl.hidden_at IS NULL AND (
  (n.type='club_organizer_lost' AND ${currentAdmin} AND r.club_suspended AND ce.created_at>=r.updated_at AND r.status='planned' AND (r.recurrence='weekly' OR r.started_at>${clock}))
  OR (cl.archived_at IS NULL AND (cl.owner_id IS NULL OR NOT clo.blocked) AND (
   (n.type='club_application' AND ${currentAdmin} AND ${currentTarget} AND ce.target_state='pending')
   OR (n.type='club_invitation' AND n.recipient_id=ce.target_id AND ${currentTarget} AND EXISTS(SELECT 1 FROM club_memberships invitation WHERE invitation.club_id=cl.id AND invitation.user_id=n.recipient_id AND invitation.state='invited' AND invitation.invite_expires_at>${clock}))
   OR (n.type='club_membership_result' AND n.recipient_id=ce.target_id AND ${currentTarget})
   OR (n.type='club_role' AND n.recipient_id=ce.target_id AND ${currentMember} AND ${currentTarget})
   OR (n.type='club_ride_new' AND ${currentMember} AND EXISTS(SELECT 1 FROM club_memberships opted WHERE opted.club_id=cl.id AND opted.user_id=n.recipient_id AND opted.notify_rides AND opted.notify_rides_since<=ce.created_at) AND r.status='planned' AND NOT r.club_suspended AND NOT ro.blocked AND (${clubRideEnvelopeSql("n.recipient_id")}) AND (${internalClubRideSql("n.recipient_id")} OR (r.is_public AND rb.is_public)) AND (r.recurrence='weekly' OR r.started_at>${clock}))
  ))))`;
}
