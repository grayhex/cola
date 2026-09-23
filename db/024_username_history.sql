-- Old usernames keep opening the profile after a rename (#71). The trigger
-- records every change, including renames made by an administrator. A current
-- username always wins over a remembered one, so a released name can be taken.
CREATE TABLE username_history (
  username text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX username_history_name ON username_history(lower(username));
CREATE INDEX username_history_user ON username_history(user_id);

CREATE FUNCTION remember_username() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF lower(NEW.username) IS DISTINCT FROM lower(OLD.username) THEN
    INSERT INTO username_history(username, user_id) VALUES (lower(OLD.username), OLD.id)
      ON CONFLICT ((lower(username))) DO UPDATE
      SET user_id=EXCLUDED.user_id, changed_at=now();
    DELETE FROM username_history WHERE lower(username)=lower(NEW.username);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER remember_username AFTER UPDATE OF username ON users
  FOR EACH ROW EXECUTE FUNCTION remember_username();
