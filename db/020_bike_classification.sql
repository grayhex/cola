-- Additive rollout: keep category/purposes and all old snapshots untouched.
-- Unknown discipline, suspension and construction are not guessed from a name.
ALTER TABLE bikes ADD COLUMN classification jsonb;
ALTER TABLE bikes DROP CONSTRAINT bikes_category_check;
ALTER TABLE bikes ADD CONSTRAINT bikes_category_check CHECK (category IN
  ('mtb','road','gravel','road_gravel','urban_touring','bmx','cargo_utility','special'));
UPDATE bikes SET classification = jsonb_build_object(
  'category', CASE WHEN category IN ('road','gravel') THEN 'road_gravel' ELSE category END,
  'subtype', CASE WHEN category IN ('road','gravel') THEN category ELSE NULL END,
  'suspension', NULL, 'construction', NULL, 'electric', false, 'fatbike', false,
  'uses', to_jsonb(ARRAY(SELECT DISTINCT CASE p WHEN 'city' THEN 'commuting' WHEN 'travel' THEN 'touring' WHEN 'sport' THEN 'racing' END
     FROM unnest(purposes) p WHERE p IN ('city','travel','sport') ORDER BY 1))
);
-- NULL is allowed only for compatibility with older writers; current API always
-- validates and stores the complete classification object.
ALTER TABLE bikes ADD CONSTRAINT bikes_classification_check CHECK (
  classification IS NULL OR (
    jsonb_typeof(classification)='object' AND
    classification ?& ARRAY['category','subtype','suspension','construction','uses','electric','fatbike'] AND
    classification->>'category' IN ('mtb','road_gravel','urban_touring','bmx','cargo_utility','special') AND
    jsonb_typeof(classification->'uses')='array' AND jsonb_array_length(classification->'uses')<=3 AND
    jsonb_typeof(classification->'electric')='boolean' AND jsonb_typeof(classification->'fatbike')='boolean'
  )
);
CREATE INDEX bikes_classification_family ON bikes ((coalesce(classification->>'category',CASE WHEN category IN ('road','gravel') THEN 'road_gravel' ELSE category END)));
CREATE INDEX bikes_classification_subtype ON bikes ((classification->>'subtype'));
CREATE INDEX bikes_classification_features ON bikes USING gin (classification jsonb_path_ops);

-- During a rolling update an older application writes only the legacy category.
-- Keep its explicit category changes coherent without erasing independent facets.
CREATE FUNCTION sync_legacy_bike_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.category IS DISTINCT FROM OLD.category AND
     NEW.classification IS NOT DISTINCT FROM OLD.classification AND
     NEW.classification IS NOT NULL THEN
    NEW.classification := NEW.classification || jsonb_build_object(
      'category', CASE WHEN NEW.category IN ('road','gravel') THEN 'road_gravel' ELSE NEW.category END,
      'subtype', CASE WHEN NEW.category IN ('road','gravel') THEN NEW.category ELSE NULL END
    );
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_legacy_bike_category BEFORE UPDATE OF category ON bikes
FOR EACH ROW EXECUTE FUNCTION sync_legacy_bike_category();
