CREATE TABLE club_posts (
 id uuid PRIMARY KEY,club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL DEFAULT '' CHECK(length(title)<=160),
 body text NOT NULL DEFAULT '' CHECK(length(body)<=20000),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
 pinned boolean NOT NULL DEFAULT false,hidden_at timestamptz,deleted_at timestamptz,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz,
 UNIQUE(id,club_id),CHECK(NOT pinned OR status='published')
);
CREATE INDEX club_posts_page ON club_posts(club_id,published_at DESC,id DESC) WHERE status='published' AND hidden_at IS NULL AND deleted_at IS NULL;
CREATE INDEX club_posts_owner ON club_posts(owner_id,created_at DESC);
CREATE UNIQUE INDEX club_one_pinned_post ON club_posts(club_id) WHERE pinned AND hidden_at IS NULL AND deleted_at IS NULL;
CREATE TABLE club_post_create_requests (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,request_id uuid NOT NULL,
 post_id uuid NOT NULL REFERENCES club_posts(id) ON DELETE CASCADE,input_hash text NOT NULL,
 PRIMARY KEY(user_id,request_id)
);
CREATE TABLE club_post_photos (
 id uuid PRIMARY KEY,post_id uuid NOT NULL REFERENCES club_posts(id) ON DELETE CASCADE,
 uploader_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,request_id uuid NOT NULL,
 filename text NOT NULL UNIQUE,size_bytes integer NOT NULL CHECK(size_bytes>0),content_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(post_id,request_id)
);
CREATE INDEX club_post_photos_post ON club_post_photos(post_id);
CREATE INDEX club_post_photos_user ON club_post_photos(uploader_id);
CREATE TABLE club_post_photo_gc(filename text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION collect_club_post_photo() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO club_post_photo_gc(filename) VALUES(OLD.filename) ON CONFLICT DO NOTHING;RETURN OLD;END $$;
CREATE TRIGGER collect_club_post_photo AFTER DELETE ON club_post_photos FOR EACH ROW EXECUTE FUNCTION collect_club_post_photo();
CREATE TABLE club_post_likes (
 post_id uuid NOT NULL REFERENCES club_posts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(post_id,user_id)
);
CREATE TABLE club_post_comments (
 id uuid PRIMARY KEY,post_id uuid NOT NULL REFERENCES club_posts(id) ON DELETE CASCADE,
 author_id uuid REFERENCES users(id) ON DELETE SET NULL,parent_id uuid,body text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,
 UNIQUE(id,post_id),FOREIGN KEY(parent_id,post_id) REFERENCES club_post_comments(id,post_id) ON DELETE CASCADE,
 CHECK(parent_id IS NULL OR parent_id<>id),CHECK((deleted_at IS NOT NULL AND body='') OR (deleted_at IS NULL AND length(body) BETWEEN 1 AND 1000))
);
CREATE INDEX club_post_comments_page ON club_post_comments(post_id,created_at,id) WHERE parent_id IS NULL;
CREATE INDEX club_post_comments_replies ON club_post_comments(parent_id,created_at,id);
CREATE FUNCTION immutable_club_comment_thread() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.post_id IS DISTINCT FROM OLD.post_id) THEN RAISE EXCEPTION 'Comment thread is immutable' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' AND NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM club_post_comments WHERE id=NEW.parent_id AND post_id=NEW.post_id) THEN RAISE EXCEPTION 'Comment parent must already exist in the same entity' USING ERRCODE='23503';END IF;
 RETURN NEW;END $$;
CREATE TRIGGER immutable_club_comment_thread BEFORE INSERT OR UPDATE ON club_post_comments FOR EACH ROW EXECUTE FUNCTION immutable_club_comment_thread();

ALTER TABLE notifications ADD COLUMN club_id uuid REFERENCES clubs(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN club_post_id uuid;
ALTER TABLE notifications ADD COLUMN club_post_comment_id uuid;
ALTER TABLE notifications ADD FOREIGN KEY(club_post_id,club_id) REFERENCES club_posts(id,club_id) ON DELETE CASCADE;
ALTER TABLE notifications ADD FOREIGN KEY(club_post_comment_id,club_post_id) REFERENCES club_post_comments(id,post_id) ON DELETE CASCADE;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='notifications'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%market_expiring%' LOOP
  EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I',c.conname);
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT %I CHECK((%s) OR type IN (''club_post_like'',''club_post_comment'',''club_post_reply''))',c.conname,substring(c.definition FROM 8 FOR length(c.definition)-8));
 END LOOP;
END $$;
ALTER TABLE notifications ADD CONSTRAINT notifications_club_post_shape CHECK(
 (type NOT IN ('club_post_like','club_post_comment','club_post_reply') AND club_id IS NULL AND club_post_id IS NULL AND club_post_comment_id IS NULL)
 OR (type IN ('club_post_like','club_post_comment','club_post_reply') AND actor_id IS NOT NULL AND club_id IS NOT NULL AND club_post_id IS NOT NULL
 AND bike_id IS NULL AND comment_id IS NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL AND listing_id IS NULL AND component_id IS NULL AND component_comment_id IS NULL AND intent_id IS NULL AND event_occurs_at IS NULL AND event_revision IS NULL
 AND ((type='club_post_like' AND club_post_comment_id IS NULL) OR (type IN ('club_post_comment','club_post_reply') AND club_post_comment_id IS NOT NULL))));

ALTER TABLE community_reports DROP CONSTRAINT community_reports_entity_type_check;
ALTER TABLE community_reports ADD CHECK(entity_type IN ('comment','profile','bike','ride','ride_comment','journal','journal_comment','component_comment','component_photo','club','club_post','club_post_comment'));
