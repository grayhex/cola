CREATE TABLE ride_intents (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  readiness text NOT NULL CHECK (readiness IN ('ready','considering')),
  time_zone text NOT NULL,
  passport jsonb NOT NULL DEFAULT '{}',
  meet_new_people boolean,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','community')),
  allow_suggestions boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','deleted')),
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_intents_owner ON ride_intents(owner_id,created_at DESC,id);
CREATE TABLE ride_intent_windows (
  intent_id uuid NOT NULL REFERENCES ride_intents(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  PRIMARY KEY(intent_id,starts_at),
  CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '24 hours')
);
CREATE INDEX ride_intent_windows_expiry ON ride_intent_windows(ends_at,intent_id);
CREATE TABLE ride_intent_preferences (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  value jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
