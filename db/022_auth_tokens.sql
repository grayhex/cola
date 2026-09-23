-- One-time links sent by email: password reset and address verification;
-- email_change is reserved for address changes so this CHECK need not change.
-- Only a SHA-256 digest of the token is stored; the raw token lives in the link.
CREATE TABLE auth_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('password_reset','email_verify','email_change')),
  -- Target address for verify/change links; changes are applied only if it still matches.
  email text CHECK (email IS NULL OR length(email) <= 254),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX auth_tokens_user ON auth_tokens(user_id, purpose);
CREATE INDEX auth_tokens_expiry ON auth_tokens(expires_at);

-- Existing accounts stay unverified until they confirm their address.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;
