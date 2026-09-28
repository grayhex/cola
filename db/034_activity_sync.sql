-- Provider identity and credentials never enter public ride DTOs.
CREATE TABLE activity_connections (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('rwgps')), external_user_id text NOT NULL,
 credentials text NOT NULL, generation uuid NOT NULL,
 bike_id uuid REFERENCES bikes(id) ON DELETE SET NULL,
 import_since timestamptz NOT NULL, cursor_at timestamptz,
 last_sync_at timestamptz, last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,provider), UNIQUE(provider,external_user_id)
);
CREATE TABLE activity_oauth_states (
 state_hash text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_hash text NOT NULL, provider text NOT NULL, bike_id uuid,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
CREATE INDEX activity_oauth_expiry ON activity_oauth_states(expires_at);
CREATE TABLE external_activities (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider text NOT NULL, external_user_id text NOT NULL, external_id text NOT NULL,
 ride_id uuid REFERENCES rides(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','synced','ignored','waiting_bike','error','deleted','local_deleted','duplicate')),
 metadata jsonb NOT NULL DEFAULT '{}', last_error text,
 event_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,provider,external_user_id,external_id)
);
CREATE INDEX external_activities_owner ON external_activities(owner_id,updated_at DESC);
CREATE INDEX external_activities_ride ON external_activities(ride_id) WHERE ride_id IS NOT NULL;
CREATE TABLE activity_jobs (
 id uuid PRIMARY KEY, connection_id uuid NOT NULL REFERENCES activity_connections(id) ON DELETE CASCADE,
 external_id text NOT NULL DEFAULT '', action text NOT NULL CHECK(action IN ('sync','upsert','deleted')),
 event_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1,
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,external_id)
);
CREATE INDEX activity_jobs_ready ON activity_jobs(next_attempt_at);
-- Retain only the encrypted token needed for remote revocation after disconnect
-- or account deletion. No FK to an account that may already have been deleted.
CREATE TABLE activity_revocations (
 id uuid PRIMARY KEY, provider text NOT NULL, credentials text NOT NULL,
 owner_id uuid NOT NULL, external_user_id text NOT NULL,
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION queue_activity_revocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO activity_revocations(id,provider,credentials,owner_id,external_user_id) VALUES(OLD.id,OLD.provider,OLD.credentials,OLD.owner_id,OLD.external_user_id) ON CONFLICT DO NOTHING;
 RETURN OLD;
END $$;
CREATE TRIGGER activity_disconnect BEFORE DELETE ON activity_connections FOR EACH ROW EXECUTE FUNCTION queue_activity_revocation();
CREATE FUNCTION remember_deleted_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 UPDATE external_activities SET status='local_deleted',updated_at=now() WHERE ride_id=OLD.id AND status<>'deleted';
 RETURN OLD;
END $$;
CREATE TRIGGER remember_deleted_activity BEFORE DELETE ON rides FOR EACH ROW EXECUTE FUNCTION remember_deleted_activity();
ALTER TABLE rides ADD COLUMN track_file_id uuid;
ALTER TABLE rides DROP CONSTRAINT rides_source_kind_check;
ALTER TABLE rides ADD CONSTRAINT rides_source_kind_check CHECK(source_kind IN ('gpx','garmin','planned','external'));
CREATE OR REPLACE FUNCTION queue_ride_file_gc() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='rides' THEN
   INSERT INTO ride_file_gc(id,kind) VALUES(coalesce(OLD.track_file_id,OLD.id),'ride') ON CONFLICT DO NOTHING;
 ELSE
   INSERT INTO ride_file_gc(id,kind) VALUES(OLD.id,'preview') ON CONFLICT DO NOTHING;
 END IF;
 RETURN OLD;
END $$;
