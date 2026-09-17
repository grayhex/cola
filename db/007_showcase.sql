ALTER TABLE users ADD COLUMN preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE bike_likes (
  bike_id uuid NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bike_id,user_id)
);
CREATE INDEX bike_likes_user_idx ON bike_likes(user_id);
CREATE INDEX bikes_showcase_idx ON bikes(created_at DESC,id) WHERE is_public=true;
