-- Durable metadata events use the existing bell and external delivery policies.
ALTER TABLE club_event_outbox DROP CONSTRAINT club_event_outbox_kind_check;
ALTER TABLE club_event_outbox ADD CHECK(kind IN ('organizer_lost','club_archived','membership','role','ride_new'));
ALTER TABLE club_event_outbox ADD COLUMN action text;
ALTER TABLE club_event_outbox ADD COLUMN target_id uuid; -- Plain ID: no club→users FK lock.
ALTER TABLE club_event_outbox ADD COLUMN target_state text;
ALTER TABLE club_event_outbox ADD UNIQUE(id,club_id);
ALTER TABLE notifications ADD COLUMN club_event_id uuid;
ALTER TABLE notifications ADD FOREIGN KEY(club_event_id,club_id) REFERENCES club_event_outbox(id,club_id) ON DELETE CASCADE;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='notifications'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%market_expiring%' LOOP
  EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I',c.conname);
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT %I CHECK((%s) OR type IN (''club_application'',''club_invitation'',''club_membership_result'',''club_role'',''club_organizer_lost'',''club_ride_new''))',c.conname,substring(c.definition FROM 8 FOR length(c.definition)-8));
 END LOOP;
END $$;
ALTER TABLE notifications DROP CONSTRAINT notifications_club_post_shape;
ALTER TABLE notifications ADD CONSTRAINT notifications_club_post_shape CHECK(
 (type NOT IN ('club_post_like','club_post_comment','club_post_reply') AND club_post_id IS NULL AND club_post_comment_id IS NULL AND (club_id IS NULL OR club_event_id IS NOT NULL))
 OR (type IN ('club_post_like','club_post_comment','club_post_reply') AND actor_id IS NOT NULL AND club_id IS NOT NULL AND club_post_id IS NOT NULL AND club_event_id IS NULL
 AND bike_id IS NULL AND comment_id IS NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL AND listing_id IS NULL AND component_id IS NULL AND component_comment_id IS NULL AND intent_id IS NULL AND event_occurs_at IS NULL AND event_revision IS NULL
 AND ((type='club_post_like' AND club_post_comment_id IS NULL) OR (type IN ('club_post_comment','club_post_reply') AND club_post_comment_id IS NOT NULL))));
ALTER TABLE notifications ADD CONSTRAINT notifications_club_event_shape CHECK(
 (type NOT IN ('club_application','club_invitation','club_membership_result','club_role','club_organizer_lost','club_ride_new') AND club_event_id IS NULL)
 OR (type IN ('club_application','club_invitation','club_membership_result','club_role','club_organizer_lost','club_ride_new') AND club_event_id IS NOT NULL AND club_id IS NOT NULL
 AND bike_id IS NULL AND comment_id IS NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL AND listing_id IS NULL AND component_id IS NULL AND component_comment_id IS NULL AND intent_id IS NULL AND event_occurs_at IS NULL AND event_revision IS NULL AND club_post_id IS NULL AND club_post_comment_id IS NULL));
CREATE FUNCTION club_audit_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; current_member club_memberships%ROWTYPE;
BEGIN
 target:=coalesce(NEW.target_user_id,NEW.actor_id);
 SELECT * INTO current_member FROM club_memberships WHERE club_id=NEW.club_id AND user_id=target;
 IF (NEW.action='membership_join' AND current_member.state='pending') OR NEW.action IN ('member_invite','member_approve','member_reject','member_exclude','member_block','member_revoke_invite') THEN
  INSERT INTO club_event_outbox(club_id,kind,actor_id,revision,action,target_id,target_state)
  VALUES(NEW.club_id,'membership',NEW.actor_id,current_member.revision,NEW.action,target,current_member.state);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER club_audit_event AFTER INSERT ON club_audit FOR EACH ROW EXECUTE FUNCTION club_audit_event();
CREATE FUNCTION club_role_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.role IS DISTINCT FROM NEW.role AND NEW.state='active' THEN
  INSERT INTO club_event_outbox(club_id,kind,revision,action,target_id,target_state)
  VALUES(NEW.club_id,'role',NEW.revision,'role_'||NEW.role,NEW.user_id,NEW.state);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER club_role_event AFTER UPDATE OF role ON club_memberships FOR EACH ROW EXECUTE FUNCTION club_role_event();
CREATE FUNCTION club_new_ride_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.club_id IS NOT NULL AND NEW.status='planned' AND (TG_OP='INSERT' OR OLD.club_id IS NULL OR OLD.status<>'planned') THEN
  INSERT INTO club_event_outbox(club_id,kind,actor_id,ride_id,revision)
  VALUES(NEW.club_id,'ride_new',NEW.owner_id,NEW.id,NEW.agreement_revision) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER club_new_ride_event AFTER INSERT OR UPDATE OF status,club_id ON rides FOR EACH ROW EXECUTE FUNCTION club_new_ride_event();

ALTER TABLE club_memberships ADD COLUMN notify_rides_since timestamptz;
CREATE FUNCTION club_notice_preferences_leave() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state='active' AND NEW.state<>'active' THEN NEW.notify_rides:=false; NEW.notify_rides_since:=NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER club_notice_preferences_leave BEFORE UPDATE OF state ON club_memberships FOR EACH ROW EXECUTE FUNCTION club_notice_preferences_leave();

-- Bulk-created member profiles also need fresh names/avatars even before that
-- person first opens messenger and registers a chat_identity. Deletion already
-- queues an unconditional remote delete in 031 (including rolled-back upserts).
CREATE OR REPLACE FUNCTION club_chat_user_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid uuid; revoke boolean;
BEGIN
 IF (OLD.name,OLD.avatar_id,OLD.blocked,OLD.email_verified_at) IS DISTINCT FROM (NEW.name,NEW.avatar_id,NEW.blocked,NEW.email_verified_at) THEN
   revoke:=(OLD.blocked,OLD.email_verified_at) IS DISTINCT FROM (NEW.blocked,NEW.email_verified_at);
   PERFORM cola_queue_chat(NEW.id,'sync',revoke);
   FOR cid IN SELECT DISTINCT club_id FROM club_memberships WHERE user_id=NEW.id ORDER BY club_id LOOP
     PERFORM cola_queue_club_chat(cid);
     IF NEW.blocked AND revoke AND EXISTS(SELECT 1 FROM clubs WHERE id=cid AND owner_id=NEW.id) THEN PERFORM cola_queue_club_disconnect(cid); END IF;
   END LOOP;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER club_chat_user_changed ON users;
CREATE TRIGGER club_chat_user_changed AFTER UPDATE OF name,avatar_id,blocked,email_verified_at ON users FOR EACH ROW EXECUTE FUNCTION club_chat_user_changed();
