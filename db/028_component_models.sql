-- A catalog model outlives installations. No owner, price or private bike data
-- belongs here. Historical IDs/URLs are retained, including after a merge.
CREATE TABLE component_models (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 category text NOT NULL, brand text NOT NULL DEFAULT '', name text NOT NULL,
 category_slug text NOT NULL, slug text NOT NULL,
 first_public_at timestamptz,
 archived boolean NOT NULL DEFAULT false,
 merged_into uuid REFERENCES component_models(id) ON DELETE RESTRICT,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(merged_into IS NULL OR merged_into<>id)
);
CREATE INDEX component_models_new ON component_models(first_public_at DESC,id)
 WHERE first_public_at IS NOT NULL AND merged_into IS NULL AND NOT archived;
CREATE TABLE component_model_names (
 category_key text NOT NULL, name_key text NOT NULL,
 model_id uuid NOT NULL REFERENCES component_models(id) ON DELETE RESTRICT,
 PRIMARY KEY(category_key,name_key)
);
CREATE TABLE component_model_urls (
 category_slug text NOT NULL, slug text NOT NULL,
 model_id uuid NOT NULL REFERENCES component_models(id) ON DELETE RESTRICT,
 PRIMARY KEY(category_slug,slug)
);
CREATE INDEX component_model_names_model ON component_model_names(model_id);
CREATE INDEX component_model_urls_model ON component_model_urls(model_id);
ALTER TABLE components ADD COLUMN model_id uuid REFERENCES component_models(id) ON DELETE RESTRICT;
CREATE INDEX components_model ON components(model_id,bike_id);

-- Case/whitespace are spelling, punctuation/variant numbers are identity.
-- The permissive experience search normalization must NOT merge catalog rows.
CREATE FUNCTION component_key(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT lower(trim(regexp_replace(value,'\s+',' ','g')))
$$;
CREATE FUNCTION component_slug(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT trim(both '-' from regexp_replace(lower(value),'[^a-z0-9а-яё]+','-','g'))
$$;

-- All catalog mutations use this short transaction lock. They never lock
-- installations/owners back, preserving the application's user -> bike order.
CREATE FUNCTION component_model_assign(category_value text, name_value text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE model uuid; canonical text := trim(name_value); rule jsonb; settings jsonb;
 cat_slug text; name_slug text; brand_value text := ''; attempts integer := 0;
BEGIN
 PERFORM pg_advisory_xact_lock(145,0);
 SELECT coalesce(m.merged_into,m.id) INTO model FROM component_model_names n
 JOIN component_models m ON m.id=n.model_id
 WHERE n.category_key=component_key(category_value) AND n.name_key=component_key(name_value);
 IF model IS NOT NULL THEN RETURN model; END IF;
 SELECT value INTO settings FROM site_catalog WHERE id=1;
 -- Only explicit FULL-name aliases may establish identity. A substring rule
 -- such as a manufacturer spelling remains a search hint, not an automatic merge.
 LOOP
  SELECT a INTO rule FROM jsonb_array_elements(coalesce(settings->'aliases','[]')) a
   WHERE a->>'kind'='component' AND component_key(a->>'alias')=component_key(canonical)
   AND (coalesce(a->>'scope','')='' OR component_key(a->>'scope')=component_key(category_value))
   AND component_key(a->>'name')<>component_key(canonical)
   ORDER BY (coalesce(a->>'scope','')<>'') DESC,a->>'name' LIMIT 1;
  EXIT WHEN rule IS NULL OR attempts>=32;
  canonical := rule->>'name'; attempts := attempts+1;
 END LOOP;
 SELECT coalesce(m.merged_into,m.id) INTO model FROM component_model_names n
 JOIN component_models m ON m.id=n.model_id
 WHERE n.category_key=component_key(category_value) AND n.name_key=component_key(canonical);
 IF model IS NULL THEN
  model := gen_random_uuid();
  cat_slug := coalesce(nullif(component_slug(category_value),''),'component');
  name_slug := coalesce(nullif(component_slug(canonical),''),'model');
  -- A URL collision never implies that two products are the same variant.
  IF EXISTS(SELECT 1 FROM component_model_urls WHERE category_slug=cat_slug AND slug=name_slug) THEN
   name_slug := name_slug || '-' || model::text;
  END IF;
  SELECT b INTO brand_value FROM jsonb_array_elements_text(coalesce(settings->'manufacturers','[]')) b
   WHERE component_key(canonical)=component_key(b)
    OR starts_with(component_key(canonical),component_key(b)||' ')
   ORDER BY length(b) DESC,b LIMIT 1;
  INSERT INTO component_models(id,category,brand,name,category_slug,slug)
   VALUES(model,trim(category_value),coalesce(brand_value,''),canonical,cat_slug,name_slug);
  INSERT INTO component_model_names VALUES(component_key(category_value),component_key(canonical),model);
  INSERT INTO component_model_urls VALUES(cat_slug,name_slug,model);
 END IF;
 INSERT INTO component_model_names VALUES(component_key(category_value),component_key(name_value),model)
  ON CONFLICT DO NOTHING;
 INSERT INTO component_model_urls VALUES(component_slug(category_value),component_slug(name_value),model)
  ON CONFLICT DO NOTHING;
 RETURN model;
END $$;

CREATE FUNCTION link_component_model() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.model_id := component_model_assign(NEW.category,NEW.name);
 ELSIF NEW.model_id IS NULL OR ROW(NEW.category,NEW.name) IS DISTINCT FROM ROW(OLD.category,OLD.name) THEN
  NEW.model_id := component_model_assign(NEW.category,NEW.name);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER component_model_link BEFORE INSERT OR UPDATE OF category,name,model_id ON components
 FOR EACH ROW EXECUTE FUNCTION link_component_model();

-- Backfill changes only the new FK. Preserve authors' text and all snapshots.
-- Deterministic ordering reserves each old literal URL before colliding variants.
DO $$ DECLARE part record; BEGIN
 FOR part IN SELECT c.id FROM components c JOIN bikes b ON b.id=c.bike_id JOIN users u ON u.id=b.owner_id
  ORDER BY (b.is_public AND NOT u.blocked) DESC,c.created_at,c.id LOOP
  UPDATE components SET model_id=NULL WHERE id=part.id;
 END LOOP;
END $$;
ALTER TABLE components ALTER COLUMN model_id SET NOT NULL;
-- The pre-migration database retained only the current publication interval.
-- Use its earliest observable installation, never a private creation timestamp.
UPDATE component_models m SET first_public_at=v.first_public_at FROM (
 SELECT c.model_id,min(greatest(b.published_at,c.created_at)) first_public_at
 FROM components c JOIN bikes b ON b.id=c.bike_id JOIN users u ON u.id=b.owner_id
 WHERE b.is_public AND NOT u.blocked GROUP BY c.model_id
) v WHERE m.id=v.model_id;

CREATE FUNCTION publish_component_models() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(145,0);
 IF TG_TABLE_NAME='components' THEN
  UPDATE component_models m SET first_public_at=now(),updated_at=now()
   FROM component_models source, bikes b, users u
   WHERE source.id=NEW.model_id AND m.id=coalesce(source.merged_into,source.id)
    AND m.first_public_at IS NULL AND b.id=NEW.bike_id AND u.id=b.owner_id
    AND b.is_public AND NOT u.blocked;
 ELSIF TG_TABLE_NAME='bikes' THEN
  IF NEW.is_public THEN
   UPDATE component_models m SET first_public_at=now(),updated_at=now()
    WHERE m.first_public_at IS NULL AND EXISTS(
     SELECT 1 FROM components c JOIN component_models source ON source.id=c.model_id
     JOIN users u ON u.id=NEW.owner_id
     WHERE c.bike_id=NEW.id AND NOT u.blocked AND coalesce(source.merged_into,source.id)=m.id);
  END IF;
 ELSE
  IF NOT NEW.blocked THEN
   UPDATE component_models m SET first_public_at=now(),updated_at=now()
    WHERE m.first_public_at IS NULL AND EXISTS(
     SELECT 1 FROM components c JOIN component_models source ON source.id=c.model_id
     JOIN bikes b ON b.id=c.bike_id WHERE b.owner_id=NEW.id AND b.is_public
     AND coalesce(source.merged_into,source.id)=m.id);
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER component_model_public AFTER INSERT OR UPDATE OF model_id,bike_id,category,name ON components
 FOR EACH ROW EXECUTE FUNCTION publish_component_models();
CREATE TRIGGER bike_component_models_public AFTER UPDATE OF is_public,owner_id ON bikes
 FOR EACH ROW EXECUTE FUNCTION publish_component_models();
CREATE TRIGGER user_component_models_public AFTER UPDATE OF blocked ON users
 FOR EACH ROW EXECUTE FUNCTION publish_component_models();
