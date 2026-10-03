-- Idempotency keys of API v1 writes (#305): a retried creating request returns
-- the first answer instead of creating a second object. The scope is the person
-- and the request (method and path), a row lives one day, and it is written in
-- the same transaction as the object, so a failed request leaves no key behind.
CREATE TABLE api_idempotency(
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route text NOT NULL CHECK (length(route) BETWEEN 1 AND 300),
  key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status integer NOT NULL CHECK (status BETWEEN 200 AND 299),
  response jsonb NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, route, key)
);
CREATE INDEX api_idempotency_created ON api_idempotency(created_at);
