-- Native sign-in with an external provider (#304, ADR D10 in #156). The app
-- opens the system browser; the flow is the web one of #151, plus the PKCE
-- challenge of the app. At the end the server hands the app a one-time code
-- that only the holder of the matching verifier can exchange for device tokens.

-- A flow started by an app remembers the app's challenge (S256 of its verifier).
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'external_auth_flows'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%purpose%login%link%' AND pg_get_constraintdef(oid) NOT LIKE '%user_id%' LOOP
    EXECUTE format('ALTER TABLE external_auth_flows DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE external_auth_flows ADD CONSTRAINT external_auth_flows_purpose_check
  CHECK (purpose IN ('login', 'link', 'native'));
ALTER TABLE external_auth_flows ADD COLUMN app_challenge text
  CHECK (app_challenge IS NULL OR app_challenge ~ '^[A-Za-z0-9_-]{43}$');
ALTER TABLE external_auth_flows ADD CONSTRAINT external_auth_flows_native_challenge
  CHECK ((purpose = 'native') = (app_challenge IS NOT NULL));

-- A first sign-in parked for the username and documents keeps the challenge, so
-- finishing it in the browser still ends in a code for the app.
ALTER TABLE external_signups ADD COLUMN app_challenge text
  CHECK (app_challenge IS NULL OR app_challenge ~ '^[A-Za-z0-9_-]{43}$');

-- The code of the app: only its digest is stored, it lives two minutes and is
-- taken exactly once, whatever the verifier says.
CREATE TABLE native_auth_codes (
  code_hash text PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_challenge text NOT NULL CHECK (app_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '2 minutes'
);
CREATE INDEX native_auth_codes_expiry ON native_auth_codes(expires_at);
