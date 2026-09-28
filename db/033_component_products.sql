-- #221: product identity is optional; installation text and factory_spec survive.
-- Run by the normal transactional migration runner, after an operator backup.
CREATE TABLE component_product_policy (
 installation_category text PRIMARY KEY,
 product_category text NOT NULL,
 position text NOT NULL CHECK(position IN ('','front','rear','left','right'))
);
INSERT INTO component_product_policy VALUES
 ('Рама','Рама',''),
 ('Вилка','Вилка',''),
 ('Амортизатор','Амортизатор',''),
 ('Групсет','Групсет',''),
 ('Задний переключатель','Задний переключатель',''),
 ('Передний переключатель','Передний переключатель',''),
 ('Манетки / дуалы','Манетки / дуалы',''),
 ('Система / шатуны','Система / шатуны',''),
 ('Педали','Педали',''),
 ('Измеритель мощности','Измеритель мощности',''),
 ('Тормоза','Тормоза',''),
 ('Колёса','Колёса',''),
 ('Обода','Обода',''),
 ('Втулки','Втулки',''),
 ('Покрышки','Покрышки',''),
 ('Руль','Руль',''),
 ('Вынос','Вынос',''),
 ('Грипсы / обмотка','Грипсы / обмотка',''),
 ('Седло','Седло',''),
 ('Подседельный штырь','Подседельный штырь',''),
 ('Дроппер','Дроппер',''),
 ('Мотор','Мотор',''),
 ('Батарея','Батарея',''),
 ('Дисплей','Дисплей',''),
 ('Зарядное устройство','Зарядное устройство',''),
 ('Передний свет','Передний свет',''),
 ('Задний свет','Задний свет',''),
 ('Крылья','Крылья',''),
 ('Багажник','Багажник',''),
 ('Подножка','Подножка',''),
 ('Звонок','Звонок',''),
 ('Велокомпьютер','Велокомпьютер',''),
 ('Датчики','Датчики',''),
 ('Замок','Замок',''),
 ('Насос','Насос',''),
 ('Инструменты','Инструменты',''),
 ('Фляга / держатель','Фляга / держатель',''),
 ('Подседельная сумка','Подседельная сумка',''),
 ('Рамная сумка','Рамная сумка',''),
 ('Сумка на руль','Сумка на руль',''),
 ('Передняя покрышка','Покрышки','front'),
 ('Задняя покрышка','Покрышки','rear'),
 ('Передний обод','Обода','front'),
 ('Задний обод','Обода','rear'),
 ('Передняя втулка','Втулки','front'),
 ('Задняя втулка','Втулки','rear'),
 ('Переднее колесо','Колёса','front'),
 ('Заднее колесо','Колёса','rear'),
 ('Передний тормоз','Тормоза','front'),
 ('Задний тормоз','Тормоза','rear'),
 ('Левая манетка','Манетки / дуалы','left'),
 ('Правая манетка','Манетки / дуалы','right');

CREATE FUNCTION component_catalog_category(value text) RETURNS text LANGUAGE sql STABLE STRICT AS $$
 SELECT product_category FROM component_product_policy
 WHERE component_key(installation_category)=component_key(value)
$$;
CREATE FUNCTION component_installation_position(value text) RETURNS text LANGUAGE sql STABLE STRICT AS $$
 SELECT coalesce((SELECT position FROM component_product_policy
 WHERE component_key(installation_category)=component_key(value)),'')
$$;
-- Conservative automatic admission. Administrators can extend manufacturers
-- in the existing catalog settings; an unknown brand remains specification-only.
CREATE FUNCTION component_catalog_brand(value text) RETURNS text LANGUAGE sql STABLE STRICT AS $$
 SELECT b FROM (
 SELECT unnest(ARRAY['Busch & Müller','DT Swiss','Selle Royal','Selle Italia','Race Face','SR Suntour','X-Fusion','RockShox','Continental','Specialized','Schwalbe','Shimano','SRAM','Gates','CUBE','ACID','Brooks','FSA','FOX','Bosch','Canyon','Giant','Syncros','Maxxis','Roval','Fizik','Ergon','WTB','Kenda','Tektro','TRP','Promax','Magura','Ritchey','Bontrager','Zipp','Easton','Mavic','Fulcrum','Campagnolo','KMC','Pirelli','Panaracer','Vittoria','Truvativ','Newmen','Alexrims','Formula','Bafang','Tange','VP','Wellgo','Cane Creek','OneUp','KS','Öhlins','PRO','Hunt','Hope','Garmin','Wahoo','Hammerhead','Bryton','Lezyne','Cateye','Knog','Fenix','Apidura','Ortlieb','Topeak','SKS','Elite','CamelBak','Crankbrothers','Look','ABUS','Kryptonite']) b
 UNION SELECT jsonb_array_elements_text(coalesce(value->'manufacturers','[]'))
 FROM site_catalog WHERE id=1
 ) brands WHERE component_key(b)<>'' AND starts_with(component_key($1),component_key(b)||' ')
 ORDER BY length(b) DESC,b LIMIT 1
$$;
CREATE FUNCTION component_catalog_name(value text) RETURNS boolean LANGUAGE sql STABLE STRICT AS $$
 SELECT coalesce(length(trim(value))<=150 AND array_length(regexp_split_to_array(trim(value),'\s+'),1)<=12
 AND value !~ '[,;!?]|&#|[[:cntrl:]]'
 AND component_catalog_brand(value) IS NOT NULL
 AND length(trim(substring(value FROM length(component_catalog_brand(value))+1)))>0
 AND trim(substring(value FROM length(component_catalog_brand(value))+1)) !~*
 '^(alloy|aluminium|aluminum|carbon|steel|integrated|internal|sealed|hydraulic|disc|one-piece|custom|интегрированн|внутренн|закрыт|алюмини|сталь|карбон|гидравлическ|[0-9 .-]+(alloy|alumini))'
 ,false)
$$;

ALTER TABLE components ALTER COLUMN model_id DROP NOT NULL;
ALTER TABLE components ADD COLUMN position text NOT NULL DEFAULT ''
 CHECK(position IN ('','front','rear','left','right'));
DROP TRIGGER component_model_link ON components;

-- Drop only non-products. Preserve installations, original specification,
-- journal snapshots and market listings; removed gallery files enter normal GC.
CREATE TEMP TABLE removed_component_products ON COMMIT DROP AS
 SELECT s.id FROM component_models s JOIN component_models m ON m.id=coalesce(s.merged_into,s.id)
 WHERE component_catalog_category(m.category) IS NULL OR NOT component_catalog_name(m.name);
UPDATE components SET model_id=NULL WHERE model_id IN (SELECT id FROM removed_component_products);
DELETE FROM notifications WHERE component_id IN (SELECT id FROM removed_component_products);
DELETE FROM community_reports WHERE
 (entity_type='component_photo' AND target_id IN (SELECT id FROM component_photos WHERE model_id IN (SELECT id FROM removed_component_products))) OR
 (entity_type='component_comment' AND target_id IN (SELECT id FROM component_comments WHERE model_id IN (SELECT id FROM removed_component_products)));
DELETE FROM component_comments WHERE model_id IN (SELECT id FROM removed_component_products) AND parent_id IS NOT NULL;
DELETE FROM component_comments WHERE model_id IN (SELECT id FROM removed_component_products);
DELETE FROM component_photos WHERE model_id IN (SELECT id FROM removed_component_products);
DELETE FROM component_model_names WHERE model_id IN (SELECT id FROM removed_component_products);
DELETE FROM component_model_urls WHERE model_id IN (SELECT id FROM removed_component_products);
UPDATE component_models SET merged_into=NULL WHERE id IN (SELECT id FROM removed_component_products);
DELETE FROM component_models WHERE id IN (SELECT id FROM removed_component_products);

-- Reuse the established identity/URL collision machinery. Merge paired product
-- rows, retaining valid product content and resolving existing references.
DO $$ DECLARE m record; target uuid; category_value text; BEGIN
 FOR m IN SELECT * FROM component_models WHERE merged_into IS NULL ORDER BY created_at,id LOOP
  category_value := component_catalog_category(m.category);
  IF category_value=m.category THEN CONTINUE; END IF;
  target := component_model_assign(category_value,m.name);
  UPDATE component_models SET merged_into=target WHERE id=m.id OR merged_into=m.id;
  UPDATE component_models SET first_public_at=least(first_public_at,m.first_public_at),
   brand=CASE WHEN brand='' THEN m.brand ELSE brand END,
   cover_photo_id=coalesce(cover_photo_id,m.cover_photo_id)
   WHERE id=target;
  INSERT INTO component_model_names(category_key,name_key,model_id)
   SELECT component_key(category_value),name_key,target FROM component_model_names WHERE model_id=m.id
   ON CONFLICT DO NOTHING;
 END LOOP;
END $$;

ALTER FUNCTION component_model_assign(text,text) RENAME TO component_model_assign_product;
CREATE FUNCTION component_model_assign(category_value text,name_value text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE category_name text := component_catalog_category(category_value);
 canonical text := trim(name_value); model uuid; settings jsonb; rule jsonb; attempts integer := 0;
BEGIN
 IF category_name IS NULL THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(145,0);
 SELECT coalesce(m.merged_into,m.id) INTO model FROM component_model_names n
 JOIN component_models m ON m.id=n.model_id
 WHERE n.category_key=component_key(category_name) AND n.name_key=component_key(canonical);
 IF model IS NOT NULL THEN RETURN model; END IF;
 SELECT value INTO settings FROM site_catalog WHERE id=1;
 LOOP
  SELECT a INTO rule FROM jsonb_array_elements(coalesce(settings->'aliases','[]')) a
   WHERE a->>'kind'='component' AND component_key(a->>'alias')=component_key(canonical)
   AND (coalesce(a->>'scope','')='' OR component_catalog_category(a->>'scope')=category_name)
   AND component_key(a->>'name')<>component_key(canonical)
   ORDER BY (coalesce(a->>'scope','')<>'') DESC,a->>'name' LIMIT 1;
  EXIT WHEN rule IS NULL OR attempts>=32;
  canonical := rule->>'name'; attempts := attempts+1;
 END LOOP;
 IF NOT component_catalog_name(canonical) THEN RETURN NULL; END IF;
 model := component_model_assign_product(category_name,canonical);
 UPDATE component_models SET brand=component_catalog_brand(canonical) WHERE id=model AND brand='';
 INSERT INTO component_model_names VALUES(component_key(category_name),component_key(name_value),model)
  ON CONFLICT DO NOTHING;
 RETURN model;
END $$;

CREATE OR REPLACE FUNCTION link_component_model() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Always derive from the installation, never accept a caller-supplied model FK.
 NEW.position := component_installation_position(NEW.category);
 NEW.model_id := component_model_assign(NEW.category,NEW.name);
 RETURN NEW;
END $$;
CREATE TRIGGER component_model_link BEFORE INSERT OR UPDATE OF category,name,model_id,position ON components
 FOR EACH ROW EXECUTE FUNCTION link_component_model();
-- This updates only relation/position, never the owner's description or price.
UPDATE components SET model_id=NULL;

