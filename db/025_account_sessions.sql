-- Signed-in devices for the account page (#70): a public id to end one
-- session, when it started, when it was last seen and the browser it names.
-- The volatile default gives every existing session its own id.
ALTER TABLE sessions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX sessions_public_id ON sessions(id);
ALTER TABLE sessions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN user_agent text NOT NULL DEFAULT ''
  CHECK (length(user_agent) <= 300);
CREATE INDEX sessions_user ON sessions(user_id);
