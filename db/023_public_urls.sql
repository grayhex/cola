-- Public identifiers are independent of internal UUIDs and legacy share tokens.
-- Keep allocations after deletion: a short URL can never identify another object.
CREATE TABLE public_url_keys (
  kind text NOT NULL CHECK (kind IN ('bike','journal','ride','market','profile')),
  entity_id uuid NOT NULL,
  public_id varchar(8) NOT NULL PRIMARY KEY CHECK (public_id ~ '^[0-9abcdefghjkmnpqrstvwxyz]{8}$'),
  UNIQUE (kind, entity_id)
);

CREATE TABLE public_url_aliases (
  kind text NOT NULL,
  legacy_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  PRIMARY KEY(kind, legacy_id),
  FOREIGN KEY(kind, entity_id) REFERENCES public_url_keys(kind, entity_id)
);

CREATE FUNCTION allocate_public_id(entity_kind text, entity_uuid uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  allocated text;
  candidate text;
  entropy bigint;
  attempt integer;
  position integer;
  alphabet constant text := '0123456789abcdefghjkmnpqrstvwxyz';
BEGIN
  SELECT public_id INTO allocated FROM public_url_keys
    WHERE kind=entity_kind AND entity_id=entity_uuid;
  IF allocated IS NOT NULL THEN RETURN allocated; END IF;
  FOR attempt IN 1..16 LOOP
    -- The first 40 bits of a v4 UUID are random (before its version bits).
    entropy := ('x' || left(replace(gen_random_uuid()::text, '-', ''), 10))::bit(40)::bigint;
    candidate := '';
    FOR position IN 1..8 LOOP
      candidate := substr(alphabet, (entropy % 32)::integer + 1, 1) || candidate;
      entropy := entropy / 32;
    END LOOP;
    INSERT INTO public_url_keys(kind, entity_id, public_id)
      VALUES(entity_kind, entity_uuid, candidate) ON CONFLICT DO NOTHING;
    SELECT public_id INTO allocated FROM public_url_keys
      WHERE kind=entity_kind AND entity_id=entity_uuid;
    IF allocated IS NOT NULL THEN RETURN allocated; END IF;
  END LOOP;
  RAISE EXCEPTION 'Could not allocate a unique public identifier';
END $$;

CREATE FUNCTION public_url_slug(value text, fallback text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(nullif(trim(both '-' from left(trim(both '-' from
    regexp_replace(lower(coalesce(value,'')), '[^a-z0-9а-яё]+', '-', 'g')), 72)), ''), fallback)
$$;

CREATE FUNCTION maintain_public_url() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE legacy uuid;
BEGIN
  IF TG_OP='UPDATE' AND OLD.public_id IS NOT NULL AND
    NEW.public_id IS DISTINCT FROM OLD.public_id THEN
    RAISE EXCEPTION 'public_id is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.public_id IS NULL THEN
    NEW.public_id := allocate_public_id(TG_ARGV[0], NEW.id);
  ELSIF NOT EXISTS (SELECT 1 FROM public_url_keys
    WHERE kind=TG_ARGV[0] AND entity_id=NEW.id AND public_id=NEW.public_id) THEN
    RAISE EXCEPTION 'public_id must be allocated for this entity' USING ERRCODE='23514';
  END IF;
  IF TG_ARGV[0]='profile' THEN
    NEW.slug := coalesce(nullif(lower(NEW.username), ''), 'profile');
  ELSE
    NEW.slug := public_url_slug(to_jsonb(NEW)->>TG_ARGV[1], TG_ARGV[0]);
  END IF;
  legacy := coalesce((to_jsonb(NEW)->>'share_id')::uuid, NEW.id);
  INSERT INTO public_url_aliases(kind, legacy_id, entity_id)
    VALUES(TG_ARGV[0], legacy, NEW.id) ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public_url_aliases
    WHERE kind=TG_ARGV[0] AND legacy_id=legacy AND entity_id=NEW.id) THEN
    RAISE EXCEPTION 'A legacy URL cannot be reassigned' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('bikes','bike','name'),
    ('journal_entries','journal','title'),
    ('rides','ride','title'),
    ('market_listings','market','title'),
    ('users','profile','username')
  ) AS entities(table_name,kind,title_column) LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN public_id varchar(8), ADD COLUMN slug text', item.table_name);
    EXECUTE format('CREATE TRIGGER zz_public_url_identity BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION maintain_public_url(%L,%L)',
      item.table_name,item.kind,item.title_column);
    -- Trigger backfill is deterministic on repeats and does not touch user content.
    EXECUTE format('UPDATE %I SET slug=NULL', item.table_name);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN public_id SET NOT NULL, ALTER COLUMN slug SET NOT NULL, ADD UNIQUE(public_id)', item.table_name);
  END LOOP;
END $$;

CREATE INDEX users_public_slug ON users(slug);

-- This view owns the public-link visibility contract, not authorization for writes.
-- Owners and invited riders are admitted explicitly by the server-only resolver.
CREATE VIEW public_entity_links AS
SELECT 'bike'::text kind,b.id entity_id,b.share_id legacy_id,b.public_id,b.slug,b.owner_id,b.is_public
  FROM bikes b JOIN users u ON u.id=b.owner_id WHERE NOT u.blocked
UNION ALL
SELECT 'journal',e.id,e.share_id,e.public_id,e.slug,e.owner_id,
  e.status='published' AND e.is_public AND b.is_public
  FROM journal_entries e JOIN bikes b ON b.id=e.bike_id JOIN users u ON u.id=e.owner_id WHERE NOT u.blocked
UNION ALL
SELECT 'ride',r.id,r.share_id,r.public_id,r.slug,r.owner_id,r.is_public AND b.is_public
  FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id WHERE NOT u.blocked
UNION ALL
SELECT 'market',m.id,m.share_id,m.public_id,m.slug,m.owner_id,m.status IN ('active','sold')
  FROM market_listings m JOIN users u ON u.id=m.owner_id WHERE NOT u.blocked
UNION ALL
SELECT 'profile',u.id,u.id,u.public_id,u.slug,u.id,true
  FROM users u WHERE NOT u.blocked AND u.username IS NOT NULL;
