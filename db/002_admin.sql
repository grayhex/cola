ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin'));
ALTER TABLE users ADD COLUMN blocked boolean NOT NULL DEFAULT false;
CREATE TABLE site_settings (
 id integer PRIMARY KEY CHECK(id=1), value jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE site_catalog (
 id integer PRIMARY KEY CHECK(id=1), value jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE site_assets (
 id uuid PRIMARY KEY, name text NOT NULL, filename text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_audit (
 id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 action text NOT NULL, target text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
