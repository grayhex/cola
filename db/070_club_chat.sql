-- A club channel is a projection of SQL membership, never an ordinary group.
ALTER TABLE clubs ADD COLUMN external_chat_url text CHECK(external_chat_url IS NULL OR (length(external_chat_url)<=2048 AND external_chat_url LIKE 'https://%'));
ALTER TABLE clubs ADD COLUMN chat_revision bigint NOT NULL DEFAULT 1;
ALTER TABLE clubs ADD COLUMN chat_synced_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE clubs ADD COLUMN chat_synced_at timestamptz;
ALTER TABLE club_memberships ADD COLUMN notify_rides boolean NOT NULL DEFAULT false;
CREATE TABLE club_chat_jobs (
 club_id uuid PRIMARY KEY REFERENCES clubs(id) ON DELETE CASCADE,
 revision bigint NOT NULL,attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
-- No user FK: a club update must not lock arbitrary users after its own lock.
CREATE TABLE club_chat_revocations(club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,user_id uuid NOT NULL,revision bigint NOT NULL,attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(club_id,user_id));
CREATE FUNCTION cola_queue_club_disconnect(cid uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO club_chat_revocations(club_id,user_id,revision)
 SELECT cid,m.user_id,c.chat_revision FROM club_memberships m JOIN clubs c ON c.id=m.club_id WHERE m.club_id=cid AND m.state='active'
 ON CONFLICT(club_id,user_id) DO UPDATE SET revision=EXCLUDED.revision,attempts=0,next_attempt_at=now();
END $$;
CREATE FUNCTION cola_queue_club_chat(cid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rev bigint;
BEGIN
 UPDATE clubs SET chat_revision=chat_revision+1 WHERE id=cid RETURNING chat_revision INTO rev;
 IF rev IS NULL THEN RETURN; END IF;
 INSERT INTO club_chat_jobs(club_id,revision) VALUES(cid,rev) ON CONFLICT(club_id) DO UPDATE SET revision=EXCLUDED.revision,attempts=0,next_attempt_at=now(),updated_at=clock_timestamp();
END $$;
CREATE FUNCTION club_chat_membership_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   PERFORM cola_queue_chat(OLD.user_id,'sync',true);
   PERFORM cola_queue_club_chat(OLD.club_id);
   RETURN OLD;
 END IF;
 IF TG_OP='INSERT' OR (OLD.state,OLD.role) IS DISTINCT FROM (NEW.state,NEW.role) THEN
   IF TG_OP='UPDATE' AND OLD.state='active' AND (NEW.state<>'active' OR OLD.role IS DISTINCT FROM NEW.role) THEN
     PERFORM cola_queue_chat(NEW.user_id,'sync',true);
   END IF;
   PERFORM cola_queue_club_chat(NEW.club_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER club_chat_membership_changed AFTER INSERT OR DELETE OR UPDATE OF state,role ON club_memberships FOR EACH ROW EXECUTE FUNCTION club_chat_membership_changed();
CREATE FUNCTION club_chat_profile_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.name,OLD.logo_id,OLD.archived_at,OLD.hidden_at,OLD.owner_id) IS DISTINCT FROM (NEW.name,NEW.logo_id,NEW.archived_at,NEW.hidden_at,NEW.owner_id) THEN
   PERFORM cola_queue_club_chat(NEW.id);
   IF OLD.hidden_at IS DISTINCT FROM NEW.hidden_at OR (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL) THEN PERFORM cola_queue_club_disconnect(NEW.id); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER club_chat_profile_changed AFTER UPDATE OF name,logo_id,archived_at,hidden_at,owner_id ON clubs FOR EACH ROW EXECUTE FUNCTION club_chat_profile_changed();
CREATE FUNCTION club_chat_user_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid uuid;
BEGIN
 IF (OLD.blocked,OLD.email_verified_at) IS DISTINCT FROM (NEW.blocked,NEW.email_verified_at) THEN
   PERFORM cola_queue_chat(NEW.id,'sync',true);
   FOR cid IN SELECT DISTINCT club_id FROM club_memberships WHERE user_id=NEW.id ORDER BY club_id LOOP
     PERFORM cola_queue_club_chat(cid);
     IF NEW.blocked AND EXISTS(SELECT 1 FROM clubs WHERE id=cid AND owner_id=NEW.id) THEN PERFORM cola_queue_club_disconnect(cid); END IF;
   END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER club_chat_user_changed AFTER UPDATE OF blocked,email_verified_at ON users FOR EACH ROW EXECUTE FUNCTION club_chat_user_changed();
INSERT INTO club_chat_jobs(club_id,revision) SELECT id,chat_revision FROM clubs;
