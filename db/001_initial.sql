CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
 password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS bikes (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL, brand text NOT NULL DEFAULT '', model text NOT NULL DEFAULT '',
 year integer NOT NULL CHECK (year BETWEEN 1900 AND 2100), category text NOT NULL CHECK (category IN ('gravel','mtb','road')),
 description text NOT NULL DEFAULT '', color text NOT NULL DEFAULT '', size text NOT NULL DEFAULT '',
 weight numeric(6,2), is_public boolean NOT NULL DEFAULT false,
 share_id uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bikes_owner ON bikes(owner_id);
CREATE TABLE IF NOT EXISTS components (
 id uuid PRIMARY KEY, bike_id uuid NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
 section text NOT NULL CHECK (section IN ('build','accessories')), category text NOT NULL,
 name text NOT NULL, notes text NOT NULL DEFAULT '', price numeric(12,2) CHECK (price >= 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS photos (
 id uuid PRIMARY KEY, bike_id uuid NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
 filename text NOT NULL UNIQUE, is_cover boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_cover_per_bike ON photos(bike_id) WHERE is_cover;
CREATE TABLE IF NOT EXISTS rate_limits (
 key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS components_bike ON components(bike_id);
CREATE INDEX IF NOT EXISTS photos_bike ON photos(bike_id);
