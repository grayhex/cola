CREATE TABLE ride_settings(id integer PRIMARY KEY CHECK(id=1), value jsonb NOT NULL DEFAULT '{}');
INSERT INTO ride_settings(id) VALUES(1);
ALTER TABLE bikes ADD CONSTRAINT bikes_id_owner_unique UNIQUE(id,owner_id);
CREATE TABLE rides(
 id uuid PRIMARY KEY, share_id uuid NOT NULL UNIQUE, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 bike_id uuid NOT NULL, FOREIGN KEY(bike_id,owner_id) REFERENCES bikes(id,owner_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120), description text NOT NULL DEFAULT '' CHECK(length(description)<=3000),
 started_at timestamptz, ended_at timestamptz, distance_m integer NOT NULL CHECK(distance_m>=0), elapsed_time_s integer, moving_time_s integer, avg_speed_mps numeric, elevation_gain_m numeric,
 point_count integer NOT NULL, public_point_count integer NOT NULL, public_geometry jsonb NOT NULL,
 is_public boolean NOT NULL DEFAULT false, published_at timestamptz,
 privacy_enabled boolean NOT NULL DEFAULT false, privacy_radius_m integer NOT NULL CHECK(privacy_radius_m BETWEEN 100 AND 5000),
 source_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,source_hash)
);
CREATE INDEX rides_owner_date ON rides(owner_id,started_at DESC,id);
CREATE INDEX rides_bike_date ON rides(bike_id,started_at DESC,id);
CREATE INDEX rides_publication ON rides(published_at DESC,id) WHERE is_public;
CREATE INDEX rides_public_owner ON rides(owner_id,published_at DESC,id) WHERE is_public;
CREATE TRIGGER ride_publication BEFORE INSERT OR UPDATE OF is_public ON rides FOR EACH ROW EXECUTE FUNCTION track_bike_publication();
CREATE TABLE ride_previews(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,source_hash text NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes');
CREATE INDEX ride_preview_expiry ON ride_previews(expires_at);
CREATE INDEX ride_preview_owner ON ride_previews(owner_id);
CREATE TABLE ride_likes(ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(ride_id,user_id));
CREATE TABLE ride_comments(
 id uuid PRIMARY KEY,ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,author_id uuid REFERENCES users(id) ON DELETE SET NULL,parent_id uuid,body text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,
 UNIQUE(id,ride_id),FOREIGN KEY(parent_id,ride_id) REFERENCES ride_comments(id,ride_id) ON DELETE CASCADE,
 CHECK(parent_id IS NULL OR parent_id<>id),CHECK((deleted_at IS NOT NULL AND body='') OR (deleted_at IS NULL AND length(body) BETWEEN 1 AND 1000))
);
CREATE FUNCTION check_ride_comment_depth() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM ride_comments WHERE id=NEW.parent_id AND parent_id IS NOT NULL) THEN RAISE EXCEPTION 'Replies have only one level' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.ride_id<>OLD.ride_id) THEN RAISE EXCEPTION 'Comment thread is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER ride_comment_depth BEFORE INSERT OR UPDATE ON ride_comments FOR EACH ROW EXECUTE FUNCTION check_ride_comment_depth();
CREATE INDEX ride_comments_page ON ride_comments(ride_id,created_at,id) WHERE parent_id IS NULL;
CREATE INDEX ride_comments_replies ON ride_comments(parent_id,created_at,id);
CREATE INDEX ride_comments_count ON ride_comments(ride_id,author_id) WHERE deleted_at IS NULL;
ALTER TABLE notifications ADD COLUMN ride_id uuid REFERENCES rides(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN ride_comment_id uuid REFERENCES ride_comments(id) ON DELETE CASCADE;
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications DROP CONSTRAINT notifications_check1;
ALTER TABLE notifications ADD CHECK(type IN ('follow','like','comment','reply','ride_like','ride_comment','ride_reply'));
ALTER TABLE notifications ADD CHECK(
 (type='follow' AND bike_id IS NULL AND comment_id IS NULL AND ride_id IS NULL AND ride_comment_id IS NULL) OR
 (type='like' AND bike_id IS NOT NULL AND comment_id IS NULL AND ride_id IS NULL AND ride_comment_id IS NULL) OR
 (type IN ('comment','reply') AND bike_id IS NOT NULL AND comment_id IS NOT NULL AND ride_id IS NULL AND ride_comment_id IS NULL) OR
 (type='ride_like' AND ride_id IS NOT NULL AND ride_comment_id IS NULL AND bike_id IS NULL AND comment_id IS NULL) OR
 (type IN ('ride_comment','ride_reply') AND ride_id IS NOT NULL AND ride_comment_id IS NOT NULL AND bike_id IS NULL AND comment_id IS NULL));
ALTER TABLE community_reports DROP CONSTRAINT community_reports_entity_type_check;
ALTER TABLE community_reports ADD CHECK(entity_type IN ('comment','profile','bike','ride','ride_comment'));
-- Outbox survives user deletion and makes filesystem cleanup retryable.
CREATE TABLE ride_file_gc(id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('ride','preview')),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(id,kind));
CREATE FUNCTION queue_ride_file_gc() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO ride_file_gc(id,kind) VALUES(OLD.id,CASE WHEN TG_TABLE_NAME='rides' THEN 'ride' ELSE 'preview' END) ON CONFLICT DO NOTHING; RETURN OLD; END $$;
CREATE TRIGGER rides_file_delete AFTER DELETE ON rides FOR EACH ROW EXECUTE FUNCTION queue_ride_file_gc();
CREATE TRIGGER previews_file_delete AFTER DELETE ON ride_previews FOR EACH ROW EXECUTE FUNCTION queue_ride_file_gc();
