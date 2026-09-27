-- Only identity/lifecycle metadata lives here. Messages and channels stay in Stream.
CREATE TABLE chat_identities (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE chat_jobs (
 user_id uuid PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('sync','delete')),
 revoke_before timestamptz,
 task_id text,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION cola_queue_chat(uid uuid, operation text, revoke boolean) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
 -- Delete must also clean up a remote upsert whose local transaction rolled back.
 -- No remote profile is created for these jobs: absent vendor users are a no-op.
 IF operation<>'delete' AND NOT EXISTS (SELECT 1 FROM chat_identities WHERE user_id=uid) THEN RETURN; END IF;
 INSERT INTO chat_jobs(user_id,kind,revoke_before) VALUES(uid,operation,CASE WHEN revoke THEN clock_timestamp() END)
 ON CONFLICT(user_id) DO UPDATE SET
 kind=CASE WHEN chat_jobs.kind='delete' THEN 'delete' ELSE EXCLUDED.kind END,
 revoke_before=coalesce(EXCLUDED.revoke_before,chat_jobs.revoke_before),
 next_attempt_at=now(),updated_at=clock_timestamp();
END $$;
CREATE FUNCTION cola_chat_user_changed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN
  PERFORM cola_queue_chat(OLD.id,'delete',true); RETURN OLD;
 END IF;
 IF (OLD.name,OLD.avatar_id,OLD.blocked) IS DISTINCT FROM (NEW.name,NEW.avatar_id,NEW.blocked) THEN
  PERFORM cola_queue_chat(NEW.id,'sync',OLD.blocked IS DISTINCT FROM NEW.blocked);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER chat_user_changed BEFORE UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION cola_chat_user_changed();
CREATE FUNCTION cola_chat_session_removed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM cola_queue_chat(OLD.user_id,'sync',true); RETURN OLD;
END $$;
CREATE TRIGGER chat_session_removed AFTER DELETE ON sessions FOR EACH ROW EXECUTE FUNCTION cola_chat_session_removed();
