CREATE SCHEMA IF NOT EXISTS bike_resolver;
CREATE TABLE IF NOT EXISTS bike_resolver.cache (
 query_key text PRIMARY KEY, query jsonb NOT NULL, status text NOT NULL,
 response jsonb NOT NULL, source_url text, source_hash text,
 adapter text NOT NULL, adapter_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 last_checked_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS resolver_cache_expiry ON bike_resolver.cache(expires_at);
