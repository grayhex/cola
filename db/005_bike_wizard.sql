ALTER TABLE bikes ADD COLUMN mileage integer NOT NULL DEFAULT 0 CHECK (mileage BETWEEN 0 AND 10000000);
CREATE TABLE resolver_previews (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 response jsonb NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '2 hours'
);
CREATE INDEX resolver_previews_expiry ON resolver_previews(expires_at);
CREATE TABLE wizard_submissions (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 bike_id uuid NOT NULL REFERENCES bikes(id) ON DELETE CASCADE
);
