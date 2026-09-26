-- Stable bicycle model identity for references from the market. Like component
-- models, this is a public catalog entry, never an owner's particular bicycle.
CREATE TABLE bike_models (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 brand text NOT NULL, name text NOT NULL, brand_slug text NOT NULL, slug text NOT NULL,
 first_public_at timestamptz, archived boolean NOT NULL DEFAULT false,
 merged_into uuid REFERENCES bike_models(id) ON DELETE RESTRICT,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(merged_into IS NULL OR merged_into<>id)
);
CREATE TABLE bike_model_names (
 brand_key text NOT NULL, name_key text NOT NULL,
 model_id uuid NOT NULL REFERENCES bike_models(id) ON DELETE RESTRICT,
 PRIMARY KEY(brand_key,name_key)
);
CREATE TABLE bike_model_urls (
 brand_slug text NOT NULL, slug text NOT NULL,
 model_id uuid NOT NULL REFERENCES bike_models(id) ON DELETE RESTRICT,
 PRIMARY KEY(brand_slug,slug)
);
CREATE INDEX bike_model_names_model ON bike_model_names(model_id);
CREATE INDEX bike_model_urls_model ON bike_model_urls(model_id);
CREATE INDEX bike_models_public ON bike_models(first_public_at DESC,id)
 WHERE first_public_at IS NOT NULL AND merged_into IS NULL AND NOT archived;
ALTER TABLE bikes ADD COLUMN catalog_model_id uuid REFERENCES bike_models(id) ON DELETE RESTRICT;
CREATE INDEX bikes_catalog_model ON bikes(catalog_model_id);

CREATE FUNCTION bike_model_assign(brand_value text,name_value text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE model uuid; canonical_brand text := trim(brand_value); canonical_name text := trim(name_value);
 settings jsonb; rule jsonb; attempts integer := 0; brand_url text; model_url text;
BEGIN
 IF component_slug(brand_value)='' OR component_slug(name_value)='' THEN RETURN NULL; END IF;
 -- Use the same catalog lock as components: bicycle writes can touch both.
 PERFORM pg_advisory_xact_lock(145,0);
 SELECT coalesce(m.merged_into,m.id) INTO model FROM bike_model_names n JOIN bike_models m ON m.id=n.model_id
  WHERE n.brand_key=component_key(brand_value) AND n.name_key=component_key(name_value);
 IF model IS NOT NULL THEN RETURN model; END IF;
 SELECT value INTO settings FROM site_catalog WHERE id=1;
 LOOP
  SELECT a INTO rule FROM jsonb_array_elements(coalesce(settings->'aliases','[]')) a
   WHERE a->>'kind'='brand' AND component_key(a->>'alias')=component_key(canonical_brand)
    AND component_key(a->>'name')<>component_key(canonical_brand) ORDER BY a->>'name' LIMIT 1;
  EXIT WHEN rule IS NULL OR attempts>=32;
  canonical_brand := rule->>'name'; attempts := attempts+1;
 END LOOP;
 attempts := 0;
 LOOP
  SELECT a INTO rule FROM jsonb_array_elements(coalesce(settings->'aliases','[]')) a
   WHERE a->>'kind'='model' AND component_key(a->>'alias')=component_key(canonical_name)
    AND (coalesce(a->>'scope','')='' OR component_key(a->>'scope')=component_key(canonical_brand))
    AND component_key(a->>'name')<>component_key(canonical_name)
   ORDER BY (coalesce(a->>'scope','')<>'') DESC,a->>'name' LIMIT 1;
  EXIT WHEN rule IS NULL OR attempts>=32;
  canonical_name := rule->>'name'; attempts := attempts+1;
 END LOOP;
 SELECT coalesce(m.merged_into,m.id) INTO model FROM bike_model_names n JOIN bike_models m ON m.id=n.model_id
  WHERE n.brand_key=component_key(canonical_brand) AND n.name_key=component_key(canonical_name);
 IF model IS NULL THEN
  model := gen_random_uuid();
  brand_url := component_slug(canonical_brand); model_url := component_slug(canonical_name);
  IF EXISTS(SELECT 1 FROM bike_model_urls WHERE brand_slug=brand_url AND slug=model_url) THEN
   model_url := model_url || '-' || model::text;
  END IF;
  INSERT INTO bike_models(id,brand,name,brand_slug,slug) VALUES(model,canonical_brand,canonical_name,brand_url,model_url);
  INSERT INTO bike_model_names VALUES(component_key(canonical_brand),component_key(canonical_name),model);
  INSERT INTO bike_model_urls VALUES(brand_url,model_url,model);
 END IF;
 INSERT INTO bike_model_names VALUES(component_key(brand_value),component_key(name_value),model) ON CONFLICT DO NOTHING;
 INSERT INTO bike_model_urls VALUES(component_slug(brand_value),component_slug(name_value),model) ON CONFLICT DO NOTHING;
 RETURN model;
END $$;

CREATE FUNCTION link_bike_model() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.catalog_model_id := bike_model_assign(NEW.brand,NEW.model);
 ELSIF NEW.catalog_model_id IS NULL OR ROW(NEW.brand,NEW.model) IS DISTINCT FROM ROW(OLD.brand,OLD.model) THEN
  NEW.catalog_model_id := bike_model_assign(NEW.brand,NEW.model);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bike_model_link BEFORE INSERT OR UPDATE OF brand,model,catalog_model_id ON bikes
 FOR EACH ROW EXECUTE FUNCTION link_bike_model();
DO $$ DECLARE bicycle record; BEGIN
 FOR bicycle IN SELECT b.id FROM bikes b JOIN users u ON u.id=b.owner_id
  ORDER BY (b.is_public AND NOT u.blocked) DESC,b.created_at,b.id LOOP
  UPDATE bikes SET catalog_model_id=NULL WHERE id=bicycle.id;
 END LOOP;
END $$;
UPDATE bike_models m SET first_public_at=v.first_public_at FROM (
 SELECT b.catalog_model_id,min(b.published_at) first_public_at FROM bikes b JOIN users u ON u.id=b.owner_id
 WHERE b.is_public AND NOT u.blocked GROUP BY b.catalog_model_id
) v WHERE m.id=v.catalog_model_id;
CREATE FUNCTION publish_bike_model() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(145,0);
 IF TG_TABLE_NAME='bikes' THEN
  IF NEW.is_public THEN
   UPDATE bike_models m SET first_public_at=now(),updated_at=now() FROM bike_models s
    WHERE s.id=NEW.catalog_model_id AND m.id=coalesce(s.merged_into,s.id) AND m.first_public_at IS NULL
     AND EXISTS(SELECT 1 FROM users WHERE id=NEW.owner_id AND NOT blocked);
  END IF;
 ELSIF NOT NEW.blocked THEN
  UPDATE bike_models m SET first_public_at=now(),updated_at=now() WHERE m.first_public_at IS NULL
   AND EXISTS(SELECT 1 FROM bikes b JOIN bike_models s ON s.id=b.catalog_model_id
    WHERE b.owner_id=NEW.id AND b.is_public AND coalesce(s.merged_into,s.id)=m.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bike_model_public AFTER INSERT OR UPDATE OF brand,model,catalog_model_id,is_public,owner_id ON bikes
 FOR EACH ROW EXECUTE FUNCTION publish_bike_model();
CREATE TRIGGER user_bike_models_public AFTER UPDATE OF blocked ON users
 FOR EACH ROW EXECUTE FUNCTION publish_bike_model();

ALTER TABLE market_listings
 ADD COLUMN component_model_id uuid REFERENCES component_models(id) ON DELETE SET NULL,
 ADD COLUMN bike_model_id uuid REFERENCES bike_models(id) ON DELETE SET NULL,
 ADD COLUMN linked_bike_id uuid REFERENCES bikes(id) ON DELETE SET NULL,
 ADD CONSTRAINT market_model_category CHECK (
  (component_model_id IS NULL OR category='components') AND (bike_model_id IS NULL OR category='bikes')
 );
CREATE INDEX market_component_model ON market_listings(component_model_id) WHERE component_model_id IS NOT NULL;
CREATE INDEX market_bike_model ON market_listings(bike_model_id) WHERE bike_model_id IS NOT NULL;
CREATE INDEX market_linked_bike ON market_listings(linked_bike_id) WHERE linked_bike_id IS NOT NULL;
