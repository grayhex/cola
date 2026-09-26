-- Photos and discussions belong to retained catalog IDs, never installations.
CREATE TABLE component_photos (
 id uuid PRIMARY KEY, model_id uuid NOT NULL REFERENCES component_models(id) ON DELETE RESTRICT,
 author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 filename text NOT NULL UNIQUE, size_bytes integer NOT NULL CHECK(size_bytes>0),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 2400), height integer NOT NULL CHECK(height BETWEEN 1 AND 2400),
 caption text NOT NULL DEFAULT '' CHECK(length(caption)<=300),
 sort_order integer NOT NULL DEFAULT 0, hidden boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX component_photos_model ON component_photos(model_id,sort_order,created_at,id);
CREATE INDEX component_photos_author ON component_photos(author_id);
ALTER TABLE component_models ADD COLUMN cover_photo_id uuid REFERENCES component_photos(id) ON DELETE SET NULL;
ALTER TABLE component_models ADD COLUMN gallery_version integer NOT NULL DEFAULT 1;
CREATE TABLE component_photo_gc(filename text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION queue_component_photo_gc() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO component_photo_gc(filename) VALUES(OLD.filename) ON CONFLICT DO NOTHING; RETURN OLD; END $$;
CREATE TRIGGER component_photo_delete AFTER DELETE ON component_photos FOR EACH ROW EXECUTE FUNCTION queue_component_photo_gc();

-- The shared comment engine owns pagination, tombstones and reply depth.
CREATE TABLE component_comments (
 id uuid PRIMARY KEY, model_id uuid NOT NULL REFERENCES component_models(id) ON DELETE RESTRICT,
 author_id uuid REFERENCES users(id) ON DELETE SET NULL,
 parent_id uuid, body text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 UNIQUE(id,model_id), FOREIGN KEY(parent_id,model_id) REFERENCES component_comments(id,model_id) ON DELETE RESTRICT,
 CHECK(parent_id IS NULL OR parent_id<>id),
 CHECK((deleted_at IS NOT NULL AND body='') OR (deleted_at IS NULL AND length(body) BETWEEN 1 AND 1000))
);
CREATE FUNCTION check_component_comment_depth() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM component_comments WHERE id=NEW.parent_id AND parent_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Replies have only one level' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.model_id<>OLD.model_id) THEN
  RAISE EXCEPTION 'Comment thread is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER component_comment_depth BEFORE INSERT OR UPDATE ON component_comments FOR EACH ROW EXECUTE FUNCTION check_component_comment_depth();
CREATE INDEX component_comments_page ON component_comments(model_id,created_at,id) WHERE parent_id IS NULL;
CREATE INDEX component_comments_replies ON component_comments(parent_id,created_at,id);
ALTER TABLE notifications ADD COLUMN component_id uuid REFERENCES component_models(id) ON DELETE RESTRICT;
ALTER TABLE notifications ADD COLUMN component_comment_id uuid REFERENCES component_comments(id) ON DELETE CASCADE;
-- Preserve every existing event shape; only the new reply event adds a branch.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint
 WHERE conrelid='notifications'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%type%' LOOP
  EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I',c.conname);
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT %I CHECK ((type<>''component_reply'' AND component_id IS NULL AND component_comment_id IS NULL AND %s) OR (type=''component_reply'' AND actor_id IS NOT NULL AND component_id IS NOT NULL AND component_comment_id IS NOT NULL AND bike_id IS NULL AND comment_id IS NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL AND listing_id IS NULL))',c.conname,substring(c.definition from 7));
 END LOOP;
END $$;
ALTER TABLE community_reports DROP CONSTRAINT community_reports_entity_type_check;
ALTER TABLE community_reports ADD CHECK(entity_type IN ('comment','profile','bike','ride','ride_comment','journal','journal_comment','component_comment','component_photo'));
