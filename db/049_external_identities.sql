-- External sign-in (#151): a provider account is a login method of a user, never
-- a user by itself. The subject is the provider's stable account id; the
-- provider's login or email can change and is never used to find a user.
CREATE TABLE user_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('yandex')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  -- One provider account belongs to one user, and a user has one account per provider.
  UNIQUE (provider, subject),
  UNIQUE (user_id, provider)
);

-- An account made through a provider has no password until its owner sets one
-- through password recovery; NULL means "no password login", not an empty one.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Short-lived state of one redirect to a provider. Only digests of the random
-- values are stored; the row is deleted when the callback consumes it.
CREATE TABLE external_auth_flows (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  provider text NOT NULL CHECK (provider IN ('yandex')),
  purpose text NOT NULL CHECK (purpose IN ('login', 'link')),
  -- Ties the callback to the browser that started the flow (login CSRF).
  browser_hash text NOT NULL CHECK (browser_hash ~ '^[0-9a-f]{64}$'),
  code_verifier text NOT NULL CHECK (length(code_verifier) BETWEEN 43 AND 128),
  -- Link only: the account and the session that confirmed the password.
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  session_hash text,
  return_path text NOT NULL DEFAULT '/account' CHECK (length(return_path) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  CHECK ((purpose = 'link') = (user_id IS NOT NULL AND session_hash IS NOT NULL))
);
CREATE INDEX external_auth_flows_expiry ON external_auth_flows(expires_at);

-- A verified provider identity that has no account yet and waits for the
-- username and legal acceptance of the first sign-in. The token lives only in an
-- HttpOnly cookie of the browser that came back from the provider.
CREATE TABLE external_signups (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  provider text NOT NULL CHECK (provider IN ('yandex')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 128),
  name text NOT NULL DEFAULT '' CHECK (length(name) <= 60),
  email text CHECK (email IS NULL OR length(email) <= 254),
  return_path text NOT NULL DEFAULT '/account' CHECK (length(return_path) <= 300),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);
CREATE INDEX external_signups_expiry ON external_signups(expires_at);
