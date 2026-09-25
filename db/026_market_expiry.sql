-- Market (#116): a published listing lives until expires_at, people save
-- listings, and the site tells an owner three days before the term ends.

ALTER TABLE market_listings ADD COLUMN expires_at timestamptz;
-- The term the last notice was about: a new term (extension, publication)
-- earns a new notice.
ALTER TABLE market_listings ADD COLUMN expiry_notice_for timestamptz;
-- Listings already published get the default 60 days from publication, and
-- at least a week from now, so every owner hears about it three days ahead.
UPDATE market_listings
   SET expires_at = greatest(coalesce(published_at, created_at) + interval '60 days',
                             now() + interval '7 days')
 WHERE status = 'active';
ALTER TABLE market_listings ADD CONSTRAINT market_active_term
  CHECK (status <> 'active' OR expires_at IS NOT NULL);
CREATE INDEX market_expiry ON market_listings(owner_id, expires_at) WHERE status = 'active';

CREATE TABLE market_saves (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 listing_id uuid NOT NULL REFERENCES market_listings(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id, listing_id)
);
CREATE INDEX market_saves_page ON market_saves(user_id, created_at DESC, listing_id);
CREATE INDEX market_saves_listing ON market_saves(listing_id);

-- A notice from the site itself has no actor.
ALTER TABLE notifications ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE notifications ADD COLUMN listing_id uuid REFERENCES market_listings(id) ON DELETE CASCADE;
CREATE INDEX notifications_listing ON notifications(listing_id) WHERE listing_id IS NOT NULL;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='notifications'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%type%' LOOP
 EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE notifications ADD CHECK(type IN ('follow','like','comment','reply','ride_like','ride_comment','ride_reply','ride_invite','journal_like','journal_comment','journal_reply','market_expiring'));
ALTER TABLE notifications ADD CHECK(
 (type='market_expiring' AND actor_id IS NULL AND listing_id IS NOT NULL AND bike_id IS NULL AND comment_id IS NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL) OR
 (type<>'market_expiring' AND actor_id IS NOT NULL AND listing_id IS NULL AND (
 (type='follow' AND bike_id IS NULL AND comment_id IS NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL) OR
 (type IN ('like','comment','reply') AND bike_id IS NOT NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL AND ((type='like' AND comment_id IS NULL) OR (type<>'like' AND comment_id IS NOT NULL))) OR
 (type IN ('ride_like','ride_invite','ride_comment','ride_reply') AND ride_id IS NOT NULL AND bike_id IS NULL AND comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL AND ((type IN ('ride_like','ride_invite') AND ride_comment_id IS NULL) OR (type IN ('ride_comment','ride_reply') AND ride_comment_id IS NOT NULL))) OR
 (type IN ('journal_like','journal_comment','journal_reply') AND entry_id IS NOT NULL AND bike_id IS NULL AND comment_id IS NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND ((type='journal_like' AND entry_comment_id IS NULL) OR (type<>'journal_like' AND entry_comment_id IS NOT NULL)))
 ))
);
