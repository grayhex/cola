-- A weekly series keeps one route and a separate RSVP for each occurrence.
ALTER TABLE rides ADD COLUMN recurrence text NOT NULL DEFAULT 'none' CHECK(recurrence IN ('none','weekly'));
ALTER TABLE rides ADD COLUMN recurrence_timezone text NOT NULL DEFAULT 'Europe/Moscow';
ALTER TABLE ride_invitations DROP CONSTRAINT ride_invitations_response_check;
ALTER TABLE ride_invitations ADD CHECK(response IN ('pending','accepted','declined','maybe'));
CREATE TABLE ride_rsvps (
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurs_at timestamptz NOT NULL,
  response text NOT NULL CHECK(response IN ('accepted','declined','maybe')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(ride_id,user_id,occurs_at)
);
INSERT INTO ride_rsvps(ride_id,user_id,occurs_at,response)
SELECT i.ride_id,i.user_id,r.started_at,i.response FROM ride_invitations i JOIN rides r ON r.id=i.ride_id WHERE i.response<>'pending' AND r.started_at IS NOT NULL;
-- Articles share the journal's photo storage, discussion and moderation limits.
ALTER TABLE journal_entries ALTER COLUMN bike_id DROP NOT NULL;
ALTER TABLE journal_entries DROP CONSTRAINT journal_entries_kind_check;
ALTER TABLE journal_entries ADD CHECK(kind IN ('build','service','review','question','story','article'));
ALTER TABLE journal_entries ADD CONSTRAINT journal_entry_bike_kind CHECK((kind='article' AND bike_id IS NULL) OR (kind<>'article' AND bike_id IS NOT NULL));
ALTER TABLE journal_entries ADD COLUMN topic_id text;
CREATE INDEX articles_published ON journal_entries(published_at DESC,id) WHERE kind='article' AND status='published' AND is_public;
