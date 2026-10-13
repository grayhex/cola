-- Clubs have a stable public UUID; renaming never changes a shared link.
CREATE TABLE clubs (
 id uuid PRIMARY KEY,
 owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 slogan text NOT NULL DEFAULT '' CHECK(length(slogan)<=180),
 city text NOT NULL DEFAULT '' CHECK(length(city)<=80),
 formats text[] NOT NULL DEFAULT '{}' CHECK(cardinality(formats)<=8),
 mission text NOT NULL DEFAULT '' CHECK(length(mission)<=20000),
 rules text NOT NULL DEFAULT '' CHECK(length(rules)<=20000),
 rules_author_id uuid REFERENCES users(id) ON DELETE SET NULL,
 rules_updated_at timestamptz,
 join_mode text NOT NULL DEFAULT 'application' CHECK(join_mode IN ('application','open')),
 members_visibility text NOT NULL DEFAULT 'members' CHECK(members_visibility IN ('public','members')),
 logo_id uuid, cover_id uuid,
 archived_at timestamptz, hidden_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(owner_id IS NOT NULL OR archived_at IS NOT NULL)
);
CREATE INDEX clubs_owner ON clubs(owner_id) WHERE archived_at IS NULL;
CREATE INDEX clubs_catalog ON clubs(created_at DESC,id) WHERE archived_at IS NULL AND hidden_at IS NULL;
CREATE TABLE club_memberships (
 club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role text NOT NULL DEFAULT 'member' CHECK(role IN ('owner','admin','organizer','member')),
 state text NOT NULL CHECK(state IN ('pending','invited','active','left','excluded','blocked')),
 revision integer NOT NULL DEFAULT 1,
 badge_visible boolean NOT NULL DEFAULT true, badge_order integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(club_id,user_id), CHECK(role!='owner' OR state='active')
);
CREATE UNIQUE INDEX club_one_owner ON club_memberships(club_id) WHERE role='owner';
CREATE INDEX club_members_user ON club_memberships(user_id,state);
CREATE TABLE club_create_requests (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
 input_hash text NOT NULL,
 PRIMARY KEY(user_id,request_id)
);
CREATE TABLE club_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 action text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX club_audit_page ON club_audit(club_id,id DESC);
-- Durable cleanup uses the existing uploads directory and backup volume.
CREATE TABLE club_photo_gc (filename text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
-- Account removal preserves the public history with an explicit archived state.
CREATE FUNCTION archive_owned_clubs_on_account_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE clubs SET archived_at=coalesce(archived_at,now()),version=version+1,updated_at=now()
 WHERE owner_id=OLD.id;
 RETURN OLD;
END $$;
CREATE TRIGGER archive_owned_clubs BEFORE DELETE ON users
 FOR EACH ROW EXECUTE FUNCTION archive_owned_clubs_on_account_delete();
CREATE TABLE club_photos (
 id uuid PRIMARY KEY,club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
 uploader_id uuid REFERENCES users(id) ON DELETE SET NULL,
 purpose text NOT NULL CHECK(purpose IN ('logo','cover')),
 filename text NOT NULL UNIQUE,size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 1048576),
 UNIQUE(club_id,purpose)
);
CREATE INDEX club_photos_uploader ON club_photos(uploader_id);
CREATE FUNCTION collect_club_photo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO club_photo_gc(filename) VALUES(OLD.filename) ON CONFLICT DO NOTHING;
 RETURN OLD;
END $$;
CREATE TRIGGER collect_club_photo BEFORE DELETE ON club_photos
 FOR EACH ROW EXECUTE FUNCTION collect_club_photo();
