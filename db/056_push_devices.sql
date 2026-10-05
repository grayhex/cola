-- #342 (N2.1): native push. The registry of the phones a person may be pushed
-- to and the queue of what is sent to them. The channel is RuStore Push; the
-- table says nothing else about it, so a second provider is one more value of
-- the CHECK, not another table.

-- When the account's consent to push began. A message that was made before
-- the person switched push on is never sent afterwards, so switching it off
-- and on again does not bring the old backlog back.
ALTER TABLE notification_settings ADD COLUMN push_enabled_at timestamptz;
UPDATE notification_settings SET push_enabled_at=COALESCE(updated_at,now()) WHERE push_enabled;

-- The admin's switch of the whole channel, next to the one of all external
-- channels: push can be stopped without stopping e-mail.
ALTER TABLE notification_limits ADD COLUMN push_enabled boolean NOT NULL DEFAULT true;

-- One row for each device session (a Bearer session of the app), not for each
-- access token: the access token is short and is replaced all the time, the
-- session is what ends with a logout, a revoke, a block, a password reset and
-- the deletion of the account, and the row goes with it (ON DELETE CASCADE).
--
-- token_ciphertext: the address the provider gave the app, encrypted with the
--   key of the server (lib/push-devices.ts). The sender needs the address, so a
--   one-way hash is not enough; the plain value is never stored, logged, exported
--   or shown to the admin. token_hash only makes an address unique.
-- generation: the binding of this install to this account. It grows when the
--   address, the project or the install changes and when a revoked
--   registration is made again; a message carries the generation it was made
--   for, and one that does not match the current one is not sent.
-- installation_id: random, made by the app once per install; it tells a reinstall
--   from a rotation of the address.
-- revoked_at/revoke_reason: the registration is over (the person turned it off in
--   the app, the same address was taken by another session, the provider said
--   the address is gone). The row stays, so the generation keeps counting.
CREATE TABLE push_devices (
 session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 installation_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN ('rustore')),
 project_id text NOT NULL CHECK(project_id ~ '^[A-Za-z0-9._-]{1,100}$'),
 token_ciphertext text NOT NULL CHECK(length(token_ciphertext) BETWEEN 1 AND 12000),
 token_hash text NOT NULL CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 generation integer NOT NULL DEFAULT 1 CHECK(generation>=1),
 registered_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 revoke_reason text CHECK(revoke_reason IN ('user','replaced','invalid_token')),
 CHECK((revoked_at IS NULL)=(revoke_reason IS NULL))
);
-- An address belongs to one live registration; a phone that signs in as someone
-- else takes it over (the previous holder is revoked first).
CREATE UNIQUE INDEX push_devices_live_token ON push_devices(provider,token_hash) WHERE revoked_at IS NULL;
CREATE INDEX push_devices_user ON push_devices(user_id) WHERE revoked_at IS NULL;

-- What is sent to a device: one row for an event and a device, ever. The
-- columns are those of the e-mail outbox (lease, attempts, backoff, expiry) so
-- that the workers read alike.
--
-- generation: the one the message was made for (see above).
-- error_code: why it was not sent, or why it stopped.
CREATE TABLE push_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
 recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 device_session_id uuid NOT NULL REFERENCES push_devices(session_id) ON DELETE CASCADE,
 generation integer NOT NULL CHECK(generation>=1),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','skipped')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),
 available_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 lease_token uuid,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 error_code text CHECK(error_code IN ('expired','unavailable','preferences','muted','paused','quiet','disabled','rebound','revoked','invalid_token','rejected','provider_temporary','provider_auth','attempts_exhausted')),
 UNIQUE(notification_id,device_session_id)
);
CREATE INDEX push_deliveries_due ON push_deliveries(available_at,recipient_id,created_at,id) WHERE status IN ('pending','sending');
CREATE INDEX push_deliveries_history ON push_deliveries(finished_at) WHERE status IN ('sent','failed','skipped');
CREATE INDEX push_deliveries_device ON push_deliveries(device_session_id) WHERE status IN ('pending','sending');
