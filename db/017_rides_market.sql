ALTER TABLE rides ADD COLUMN status text NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','planned','cancelled'));
ALTER TABLE rides ADD COLUMN source_kind text NOT NULL DEFAULT 'gpx' CHECK(source_kind IN ('gpx','garmin','planned'));
ALTER TABLE rides ADD COLUMN has_track boolean NOT NULL DEFAULT true;
ALTER TABLE rides ADD COLUMN gpx_hash text;
UPDATE rides SET gpx_hash=source_hash;
CREATE UNIQUE INDEX rides_gpx_hash ON rides(owner_id,gpx_hash) WHERE gpx_hash IS NOT NULL;
ALTER TABLE rides ADD COLUMN import_metrics jsonb NOT NULL DEFAULT '{}';
ALTER TABLE rides ADD COLUMN visible_metrics jsonb;
ALTER TABLE rides ADD COLUMN features text[] NOT NULL DEFAULT '{}';
ALTER TABLE rides ADD COLUMN meeting_point text NOT NULL DEFAULT '' CHECK(length(meeting_point)<=200);
CREATE INDEX rides_upcoming ON rides(started_at,id) WHERE status='planned';
CREATE TABLE ride_invitations(
 ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 response text NOT NULL DEFAULT 'pending' CHECK(response IN ('pending','accepted','declined')),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(ride_id,user_id)
);
CREATE INDEX ride_invitation_user ON ride_invitations(user_id,ride_id);
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='notifications'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%type%' LOOP
 EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE notifications ADD CHECK(type IN ('follow','like','comment','reply','ride_like','ride_comment','ride_reply','ride_invite','journal_like','journal_comment','journal_reply'));
ALTER TABLE notifications ADD CHECK(
 (type='follow' AND bike_id IS NULL AND comment_id IS NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL) OR
 (type IN ('like','comment','reply') AND bike_id IS NOT NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL AND ((type='like' AND comment_id IS NULL) OR (type<>'like' AND comment_id IS NOT NULL))) OR
 (type IN ('ride_like','ride_invite','ride_comment','ride_reply') AND ride_id IS NOT NULL AND bike_id IS NULL AND comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL AND ((type IN ('ride_like','ride_invite') AND ride_comment_id IS NULL) OR (type IN ('ride_comment','ride_reply') AND ride_comment_id IS NOT NULL))) OR
 (type IN ('journal_like','journal_comment','journal_reply') AND entry_id IS NOT NULL AND bike_id IS NULL AND comment_id IS NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND ((type='journal_like' AND entry_comment_id IS NULL) OR (type<>'journal_like' AND entry_comment_id IS NOT NULL)))
);
CREATE TABLE market_listings(
 id uuid PRIMARY KEY, share_id uuid NOT NULL UNIQUE,owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),description text NOT NULL DEFAULT '' CHECK(length(description)<=6000),
 category text NOT NULL CHECK(category IN ('bikes','components','accessories')),
 condition text NOT NULL CHECK(condition IN ('new','used')),price numeric(12,2) NOT NULL CHECK(price>=0),
 currency text NOT NULL CHECK(currency IN ('RUB','USD','EUR')),location text NOT NULL DEFAULT '' CHECK(length(location)<=100),
 contact text NOT NULL DEFAULT '' CHECK(length(contact)<=300),status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','sold')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz
);
CREATE INDEX market_publication ON market_listings(published_at DESC,id) WHERE status='active';
CREATE INDEX market_owner ON market_listings(owner_id);
CREATE TABLE market_photos(
 id uuid PRIMARY KEY,listing_id uuid NOT NULL REFERENCES market_listings(id) ON DELETE CASCADE,
 filename text NOT NULL UNIQUE,size_bytes integer NOT NULL CHECK(size_bytes>0),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX market_photo_listing ON market_photos(listing_id);
CREATE TABLE market_photo_gc(filename text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION queue_market_photo_gc() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO market_photo_gc(filename) VALUES(OLD.filename) ON CONFLICT DO NOTHING; RETURN OLD; END $$;
CREATE TRIGGER market_photo_delete AFTER DELETE ON market_photos FOR EACH ROW EXECUTE FUNCTION queue_market_photo_gc();
