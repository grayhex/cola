ALTER TABLE users ADD COLUMN username text;
ALTER TABLE users ADD COLUMN bio text NOT NULL DEFAULT '' CHECK (length(bio)<=500);
ALTER TABLE users ADD COLUMN location text NOT NULL DEFAULT '' CHECK (length(location)<=100);
ALTER TABLE users ADD COLUMN avatar_id uuid UNIQUE;
ALTER TABLE users ADD COLUMN avatar_size_bytes bigint NOT NULL DEFAULT 0 CHECK(avatar_size_bytes>=0);
-- Stable names for existing accounts; shared UUID prefixes cannot collide.
DO $$
DECLARE rider record; candidate text; suffix integer;
BEGIN
  FOR rider IN SELECT id FROM users ORDER BY id LOOP
    candidate := 'rider-' || left(replace(rider.id::text,'-',''),8);
    suffix := 0;
    WHILE EXISTS(SELECT 1 FROM users WHERE username=candidate) LOOP
      suffix := suffix+1;
      candidate := 'rider-' || left(replace(rider.id::text,'-',''),8) || '-' || suffix;
    END LOOP;
    UPDATE users SET username=candidate WHERE id=rider.id;
  END LOOP;
END $$;
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
-- Existing registration/import SQL remains compatible; users can choose a name later.
ALTER TABLE users ALTER COLUMN username SET DEFAULT ('rider-' || left(replace(gen_random_uuid()::text,'-',''),24));
ALTER TABLE users ADD CONSTRAINT username_format CHECK(username ~ '^[a-z0-9._-]{3,30}$');
ALTER TABLE users ADD CONSTRAINT username_reserved CHECK(username NOT IN ('admin','api','account','login','logout','register','settings','b','u','me','social','profiles','assets','avatars','health','ready','status','support','help','about','system','colabike'));
CREATE UNIQUE INDEX users_username_ci ON users(lower(username));
CREATE TABLE user_follows (
  follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(follower_id,following_id),
  CHECK(follower_id<>following_id)
);
CREATE INDEX follows_followers_page ON user_follows(following_id,created_at DESC,follower_id);
CREATE INDEX follows_following_page ON user_follows(follower_id,created_at DESC,following_id);
