-- Accessory vocabulary; the data package is applied separately after deployment.
INSERT INTO component_product_policy VALUES ('Сумка на багажник','Сумка на багажник','')
ON CONFLICT (installation_category) DO NOTHING;

-- Append to existing owner-maintained lists, preserving their ordering/settings.
-- Missing/custom groups are intentionally not replaced by application defaults.
UPDATE site_catalog
SET value=jsonb_set(value,'{partCategories,accessories}',
  (value#>'{partCategories,accessories}') || '["Сумка на багажник"]'::jsonb),
  version=version+1, updated_at=now()
WHERE jsonb_typeof(value#>'{partCategories,accessories}')='array'
AND NOT (value#>'{partCategories,accessories}') ? 'Сумка на багажник';

UPDATE site_catalog
SET value=jsonb_set(value,'{componentGroups}',(
  SELECT jsonb_agg(CASE WHEN item->>'id'='equipment'
    AND jsonb_typeof(item->'categories')='array'
    AND NOT (item->'categories') ? 'Сумка на багажник'
    THEN jsonb_set(item,'{categories}',(item->'categories') || '["Сумка на багажник"]'::jsonb)
    ELSE item END ORDER BY ordinal)
  FROM jsonb_array_elements(value->'componentGroups') WITH ORDINALITY AS groups(item,ordinal)
)), version=version+1, updated_at=now()
WHERE jsonb_typeof(value->'componentGroups')='array'
AND EXISTS (SELECT 1 FROM jsonb_array_elements(value->'componentGroups') AS groups(item)
  WHERE item->>'id'='equipment' AND jsonb_typeof(item->'categories')='array'
    AND NOT (item->'categories') ? 'Сумка на багажник');

CREATE OR REPLACE FUNCTION component_catalog_brand(value text) RETURNS text LANGUAGE sql STABLE STRICT AS $$
 SELECT b FROM (
 SELECT unnest(ARRAY['Busch & Müller','DT Swiss','Selle Royal','Selle Italia','Race Face','SR Suntour','X-Fusion','RockShox','Continental','Specialized','Schwalbe','Shimano','SRAM','Gates','CUBE','ACID','Brooks','FSA','FOX','Bosch','Canyon','Giant','Syncros','Maxxis','Roval','Fizik','Ergon','WTB','Kenda','Tektro','TRP','Promax','Magura','Ritchey','Bontrager','Zipp','Easton','Mavic','Fulcrum','Campagnolo','KMC','Pirelli','Panaracer','Vittoria','Truvativ','Newmen','Alexrims','Formula','Bafang','Tange','VP','Wellgo','Cane Creek','OneUp','KS','Öhlins','PRO','Hunt','Hope','Garmin','Wahoo','Hammerhead','Bryton','Lezyne','Cateye','Knog','Fenix','Apidura','Ortlieb','Topeak','SKS','Elite','CamelBak','Crankbrothers','Manitou','Hayes','Look','ABUS','Kryptonite','Magene','SILCA','Pletscher']) b
 UNION SELECT jsonb_array_elements_text(coalesce(value->'manufacturers','[]'))
 FROM site_catalog WHERE id=1
 ) brands WHERE component_key(b)<>'' AND starts_with(component_key($1),component_key(b)||' ')
 ORDER BY length(b) DESC,b LIMIT 1
$$;
