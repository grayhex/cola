ALTER TABLE bikes ADD COLUMN published_at timestamptz;
UPDATE bikes SET published_at=created_at WHERE is_public;
CREATE FUNCTION track_bike_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.is_public THEN
   IF TG_OP='INSERT' THEN NEW.published_at=now();
   ELSIF NOT OLD.is_public THEN NEW.published_at=now();
   ELSE NEW.published_at=OLD.published_at;
   END IF;
 ELSE NEW.published_at=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bike_publication BEFORE INSERT OR UPDATE OF is_public ON bikes FOR EACH ROW EXECUTE FUNCTION track_bike_publication();
CREATE INDEX bikes_follow_feed ON bikes(owner_id,published_at DESC,id) WHERE is_public;
CREATE TABLE bike_comments (
 id uuid PRIMARY KEY, bike_id uuid NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
 author_id uuid REFERENCES users(id) ON DELETE SET NULL,
 parent_id uuid, body text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 UNIQUE(id,bike_id), FOREIGN KEY(parent_id,bike_id) REFERENCES bike_comments(id,bike_id) ON DELETE CASCADE,
 CHECK(parent_id IS NULL OR parent_id<>id),
 CHECK((deleted_at IS NOT NULL AND body='') OR (deleted_at IS NULL AND length(body) BETWEEN 1 AND 1000))
);
CREATE FUNCTION check_comment_depth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM bike_comments WHERE id=NEW.parent_id AND parent_id IS NOT NULL) THEN
   RAISE EXCEPTION 'Replies have only one level' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.bike_id<>OLD.bike_id) THEN
   RAISE EXCEPTION 'Comment thread is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER comment_depth BEFORE INSERT OR UPDATE ON bike_comments FOR EACH ROW EXECUTE FUNCTION check_comment_depth();
CREATE INDEX comments_bike_page ON bike_comments(bike_id,created_at,id) WHERE parent_id IS NULL;
CREATE INDEX comments_replies ON bike_comments(parent_id,created_at,id);
CREATE INDEX comments_visible_count ON bike_comments(bike_id,author_id) WHERE deleted_at IS NULL;
CREATE TABLE notifications (
 id uuid PRIMARY KEY, recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 type text NOT NULL CHECK(type IN ('follow','like','comment','reply')),
 bike_id uuid REFERENCES bikes(id) ON DELETE CASCADE,
 comment_id uuid REFERENCES bike_comments(id) ON DELETE CASCADE,
 dedup_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz,
 UNIQUE(recipient_id,dedup_key), CHECK(recipient_id<>actor_id),
 CHECK((type='follow' AND bike_id IS NULL AND comment_id IS NULL) OR (type='like' AND bike_id IS NOT NULL AND comment_id IS NULL) OR (type IN ('comment','reply') AND bike_id IS NOT NULL AND comment_id IS NOT NULL))
);
CREATE INDEX notifications_recipient_page ON notifications(recipient_id,created_at DESC,id);
CREATE INDEX notifications_unread ON notifications(recipient_id,created_at DESC,id) WHERE read_at IS NULL;
CREATE TABLE community_reports (
 id uuid PRIMARY KEY, reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 entity_type text NOT NULL CHECK(entity_type IN ('comment','profile','bike')),target_id uuid NOT NULL,
 reason text NOT NULL CHECK(reason IN ('spam','abuse','inappropriate','copyright','other')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
 UNIQUE(reporter_id,entity_type,target_id)
);
CREATE INDEX reports_queue ON community_reports(status,created_at DESC,id);
CREATE INDEX reports_target ON community_reports(entity_type,target_id);
