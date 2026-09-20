CREATE TABLE journal_entries (
 id uuid PRIMARY KEY, share_id uuid NOT NULL UNIQUE,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 bike_id uuid NOT NULL, FOREIGN KEY(bike_id,owner_id) REFERENCES bikes(id,owner_id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('build','service','review','question','story')),
 title text NOT NULL CHECK(length(title)<=160), body text NOT NULL CHECK(length(body)<=20000),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
 is_public boolean NOT NULL DEFAULT false,
 event_date date, mileage integer CHECK(mileage BETWEEN 0 AND 10000000),
 ride_id uuid REFERENCES rides(id) ON DELETE SET NULL,
 components jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
 CHECK(status='draft' OR (length(trim(title))>0 AND length(trim(body))>0))
);
CREATE INDEX journal_bike_date ON journal_entries(bike_id,created_at DESC,id);
CREATE INDEX journal_owner ON journal_entries(owner_id);
CREATE TABLE journal_photos (
 id uuid PRIMARY KEY, entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
 filename text NOT NULL UNIQUE, size_bytes integer NOT NULL CHECK(size_bytes>0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journal_photos_entry ON journal_photos(entry_id);
CREATE TABLE journal_photo_gc(filename text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION queue_journal_photo_gc() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO journal_photo_gc(filename) VALUES(OLD.filename) ON CONFLICT DO NOTHING; RETURN OLD; END $$;
CREATE TRIGGER journal_photo_delete AFTER DELETE ON journal_photos FOR EACH ROW EXECUTE FUNCTION queue_journal_photo_gc();
CREATE TABLE journal_likes (
 entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(entry_id,user_id)
);
CREATE TABLE journal_comments (
 id uuid PRIMARY KEY, entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
 author_id uuid REFERENCES users(id) ON DELETE SET NULL, parent_id uuid, body text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,
 UNIQUE(id,entry_id),FOREIGN KEY(parent_id,entry_id) REFERENCES journal_comments(id,entry_id) ON DELETE CASCADE,
 CHECK(parent_id IS NULL OR parent_id<>id), CHECK((deleted_at IS NOT NULL AND body='') OR (deleted_at IS NULL AND length(body) BETWEEN 1 AND 1000))
);
CREATE FUNCTION check_journal_comment_depth() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM journal_comments WHERE id=NEW.parent_id AND parent_id IS NOT NULL) THEN RAISE EXCEPTION 'Replies have only one level' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.entry_id<>OLD.entry_id) THEN RAISE EXCEPTION 'Comment thread is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER journal_comment_depth BEFORE INSERT OR UPDATE ON journal_comments FOR EACH ROW EXECUTE FUNCTION check_journal_comment_depth();
CREATE INDEX journal_comments_page ON journal_comments(entry_id,created_at,id) WHERE parent_id IS NULL;
CREATE INDEX journal_comments_replies ON journal_comments(parent_id,created_at,id);
ALTER TABLE notifications ADD COLUMN entry_id uuid REFERENCES journal_entries(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN entry_comment_id uuid REFERENCES journal_comments(id) ON DELETE CASCADE;
-- Replace only checks concerning event kinds / target shape; retain other checks.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='notifications'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%type%' LOOP
 EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE notifications ADD CHECK(type IN ('follow','like','comment','reply','ride_like','ride_comment','ride_reply','journal_like','journal_comment','journal_reply'));
ALTER TABLE notifications ADD CHECK(
 (type='follow' AND bike_id IS NULL AND comment_id IS NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL) OR
 (type IN ('like','comment','reply') AND bike_id IS NOT NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL AND ((type='like' AND comment_id IS NULL) OR (type<>'like' AND comment_id IS NOT NULL))) OR
 (type IN ('ride_like','ride_comment','ride_reply') AND ride_id IS NOT NULL AND bike_id IS NULL AND comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL AND ((type='ride_like' AND ride_comment_id IS NULL) OR (type<>'ride_like' AND ride_comment_id IS NOT NULL))) OR
 (type IN ('journal_like','journal_comment','journal_reply') AND entry_id IS NOT NULL AND bike_id IS NULL AND comment_id IS NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND ((type='journal_like' AND entry_comment_id IS NULL) OR (type<>'journal_like' AND entry_comment_id IS NOT NULL)))
);
ALTER TABLE community_reports DROP CONSTRAINT community_reports_entity_type_check;
ALTER TABLE community_reports ADD CHECK(entity_type IN ('comment','profile','bike','ride','ride_comment','journal','journal_comment'));
