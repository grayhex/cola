-- Official Manitou and Hayes product catalogs: https://hayesbicycle.com/
-- Keep the conservative shared Resolver vocabulary and SQL admission aligned.
CREATE OR REPLACE FUNCTION component_catalog_brand(value text) RETURNS text LANGUAGE sql STABLE STRICT AS $$
 SELECT b FROM (
 SELECT unnest(ARRAY['Busch & Müller','DT Swiss','Selle Royal','Selle Italia','Race Face','SR Suntour','X-Fusion','RockShox','Continental','Specialized','Schwalbe','Shimano','SRAM','Gates','CUBE','ACID','Brooks','FSA','FOX','Bosch','Canyon','Giant','Syncros','Maxxis','Roval','Fizik','Ergon','WTB','Kenda','Tektro','TRP','Promax','Magura','Ritchey','Bontrager','Zipp','Easton','Mavic','Fulcrum','Campagnolo','KMC','Pirelli','Panaracer','Vittoria','Truvativ','Newmen','Alexrims','Formula','Bafang','Tange','VP','Wellgo','Cane Creek','OneUp','KS','Öhlins','PRO','Hunt','Hope','Garmin','Wahoo','Hammerhead','Bryton','Lezyne','Cateye','Knog','Fenix','Apidura','Ortlieb','Topeak','SKS','Elite','CamelBak','Crankbrothers','Manitou','Hayes','Look','ABUS','Kryptonite']) b
 UNION SELECT jsonb_array_elements_text(coalesce(value->'manufacturers','[]'))
 FROM site_catalog WHERE id=1
 ) brands WHERE component_key(b)<>'' AND starts_with(component_key($1),component_key(b)||' ')
 ORDER BY length(b) DESC,b LIMIT 1
$$;
