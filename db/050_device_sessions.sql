-- Device sessions for native clients (#303, ADR in #156): one more kind of row in
-- the same table, so the device list, sign out everywhere, password change
-- and reset, blocking and account deletion already act on them.
-- A browser row keeps working exactly as before (kind='browser').
ALTER TABLE sessions ADD COLUMN kind text NOT NULL DEFAULT 'browser'
  CHECK (kind IN ('browser', 'device'));
ALTER TABLE sessions ADD COLUMN device_name text
  CHECK (device_name IS NULL OR length(device_name) BETWEEN 1 AND 100);
ALTER TABLE sessions ADD COLUMN platform text
  CHECK (platform IS NULL OR platform IN ('ios', 'android', 'other'));
ALTER TABLE sessions ADD COLUMN app_version text
  CHECK (app_version IS NULL OR length(app_version) BETWEEN 1 AND 40);
-- For a device, token_hash is the digest of the current access token; it is
-- replaced by UPDATE on every refresh (a DELETE would fire chat_session_removed
-- and revoke the chat tokens of every device of the person).
ALTER TABLE sessions ADD COLUMN access_expires_at timestamptz;
-- Digests of the current refresh token and of the one it replaced.
ALTER TABLE sessions ADD COLUMN refresh_hash text
  CHECK (refresh_hash IS NULL OR refresh_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE sessions ADD COLUMN previous_refresh_hash text
  CHECK (previous_refresh_hash IS NULL OR previous_refresh_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE sessions ADD COLUMN rotated_at timestamptz;
-- Set by the first request made with the current access token: after that the
-- client has certainly received the last refresh answer, so a replay of the
-- previous refresh token is theft, not a lost response.
ALTER TABLE sessions ADD COLUMN access_used_at timestamptz;
-- Idle expiry stays in expires_at (capped to this absolute limit).
ALTER TABLE sessions ADD COLUMN absolute_expires_at timestamptz;
ALTER TABLE sessions ADD CONSTRAINT sessions_device_columns CHECK (
  (kind = 'browser' AND device_name IS NULL AND refresh_hash IS NULL
    AND previous_refresh_hash IS NULL AND access_expires_at IS NULL
    AND absolute_expires_at IS NULL)
  OR (kind = 'device' AND device_name IS NOT NULL AND refresh_hash IS NOT NULL
    AND access_expires_at IS NOT NULL AND absolute_expires_at IS NOT NULL)
);
CREATE UNIQUE INDEX sessions_refresh_hash ON sessions(refresh_hash) WHERE refresh_hash IS NOT NULL;
CREATE INDEX sessions_previous_refresh_hash ON sessions(previous_refresh_hash) WHERE previous_refresh_hash IS NOT NULL;
CREATE INDEX sessions_device_user ON sessions(user_id, last_seen_at) WHERE kind = 'device';

-- A notice from the site (no actor, no target) when a refresh token is replayed.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint
  WHERE conrelid='notifications'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%type%' LOOP
  EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I',c.conname);
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT %I CHECK ((type<>''session_reuse'' AND %s) OR (type=''session_reuse'' AND actor_id IS NULL AND bike_id IS NULL AND comment_id IS NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL AND listing_id IS NULL AND component_id IS NULL AND component_comment_id IS NULL))',c.conname,substring(c.definition from 7));
 END LOOP;
END $$;
