-- Immutable release/entry journals; neither table owns an installation.
CREATE TABLE component_seed_batches (
 batch text PRIMARY KEY,
 bundle_sha256 text NOT NULL CHECK(bundle_sha256 ~ '^[a-f0-9]{64}$'),
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 backup jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 rolled_back_at timestamptz
);
CREATE TABLE component_seed_entries (
 batch text NOT NULL REFERENCES component_seed_batches(batch) ON DELETE RESTRICT,
 seed_key text NOT NULL,
 entry_sha256 text NOT NULL CHECK(entry_sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('created','filled','reused','conflict','rejected')),
 model_id uuid REFERENCES component_models(id) ON DELETE RESTRICT,
 reason text NOT NULL DEFAULT '',
 before_model jsonb,
 after_model jsonb,
 photo_ids uuid[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 rolled_back_at timestamptz,
 PRIMARY KEY(batch,seed_key)
);
CREATE INDEX component_seed_entries_identity ON component_seed_entries(seed_key,created_at);

-- Read-only counterpart of 033's full-name lookup, for dry runs. The shared
-- component_model_assign remains the only creator/URL allocator on apply.
-- Fail closed on alias cycles instead of guessing a product after 32 hops.
CREATE FUNCTION component_seed_lookup(category_value text,name_value text)
RETURNS TABLE(model_id uuid,canonical_name text,admissible boolean)
LANGUAGE plpgsql STABLE AS $$
DECLARE category_name text := component_catalog_category(category_value);
 canonical text := trim(name_value); settings jsonb; rule jsonb;
 visited text[] := '{}'; attempts integer := 0; found_id uuid;
BEGIN
 IF category_name IS NULL THEN RETURN QUERY SELECT NULL::uuid,canonical,false; RETURN; END IF;
 SELECT coalesce(m.merged_into,m.id) INTO found_id
 FROM component_model_names n JOIN component_models m ON m.id=n.model_id
 WHERE n.category_key=component_key(category_name) AND n.name_key=component_key(canonical);
 IF found_id IS NOT NULL THEN
  RETURN QUERY SELECT m.id,m.name,true FROM component_models m WHERE m.id=found_id; RETURN;
 END IF;
 SELECT value INTO settings FROM site_catalog WHERE id=1;
 LOOP
  IF component_key(canonical)=ANY(visited) OR attempts>32 THEN
   RETURN QUERY SELECT NULL::uuid,canonical,false; RETURN;
  END IF;
  visited := array_append(visited,component_key(canonical));
  SELECT a INTO rule FROM jsonb_array_elements(coalesce(settings->'aliases','[]')) a
   WHERE a->>'kind'='component' AND component_key(a->>'alias')=component_key(canonical)
   AND (coalesce(a->>'scope','')='' OR component_catalog_category(a->>'scope')=category_name)
   AND component_key(a->>'name')<>component_key(canonical)
   ORDER BY (coalesce(a->>'scope','')<>'') DESC,a->>'name' LIMIT 1;
  EXIT WHEN rule IS NULL;
  canonical := rule->>'name'; attempts := attempts+1;
 END LOOP;
 SELECT coalesce(m.merged_into,m.id) INTO found_id
 FROM component_model_names n JOIN component_models m ON m.id=n.model_id
 WHERE n.category_key=component_key(category_name) AND n.name_key=component_key(canonical);
 IF found_id IS NOT NULL THEN
  RETURN QUERY SELECT m.id,m.name,true FROM component_models m WHERE m.id=found_id; RETURN;
 END IF;
 RETURN QUERY SELECT NULL::uuid,canonical,component_catalog_name(canonical);
END $$;
