-- Empty drafts only: the owner must publish their actual documents. Historical
-- users are not assigned fabricated acceptance events.
CREATE TABLE legal_document_versions (
  kind text NOT NULL CHECK (kind IN ('terms','privacy')),
  revision integer NOT NULL CHECK (revision > 0),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 200000),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY(kind,revision)
);
CREATE TABLE legal_documents (
  kind text PRIMARY KEY CHECK (kind IN ('terms','privacy')),
  draft_body text NOT NULL DEFAULT '' CHECK (length(draft_body) <= 200000),
  draft_version integer NOT NULL DEFAULT 1 CHECK (draft_version > 0),
  published_revision integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(kind,published_revision) REFERENCES legal_document_versions(kind,revision)
);
INSERT INTO legal_documents(kind) VALUES ('terms'),('privacy');
CREATE TABLE user_legal_acceptances (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  revision integer NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,kind),
  FOREIGN KEY(kind,revision) REFERENCES legal_document_versions(kind,revision)
);
CREATE FUNCTION protect_legal_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.kind,OLD.revision,OLD.body,OLD.content_hash,OLD.published_at)
    IS DISTINCT FROM ROW(NEW.kind,NEW.revision,NEW.body,NEW.content_hash,NEW.published_at) THEN
    RAISE EXCEPTION 'Published document versions are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER legal_version_immutable BEFORE UPDATE ON legal_document_versions
FOR EACH ROW EXECUTE FUNCTION protect_legal_version();
