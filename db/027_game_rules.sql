-- Awards and records as rules (#106). The code keeps a catalog of verified
-- metrics (the functions below); the administrator builds an award (metric,
-- comparison, threshold) or a record (metric, maximum or minimum) with
-- filters, a name, a description and an illustration. Current awards and
-- records become rules with the same keys, so the award history stays.

CREATE TABLE game_rules (
 key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
 kind text NOT NULL CHECK (kind IN ('award','record')),
 -- What the metric describes: an award for a bike goes to that bike, an
 -- award for a ride or a person goes to the person.
 subject text NOT NULL CHECK (subject IN ('bike','ride','user')),
 metric text NOT NULL CHECK (metric ~ '^[a-z][a-z0-9_]{1,39}$'),
 comparison text NOT NULL DEFAULT 'gte' CHECK (comparison IN ('gte','lte')),
 threshold numeric,
 direction text CHECK (direction IN ('max','min')),
 category text CHECK (category ~ '^[a-z][a-z_]{1,39}$'),
 min_distance_km numeric CHECK (min_distance_km >= 0 AND min_distance_km <= 10000),
 keywords text[] NOT NULL DEFAULT '{}' CHECK (cardinality(keywords) <= 10),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
 description text NOT NULL DEFAULT '' CHECK (length(description) <= 160),
 image_id uuid REFERENCES site_assets(id),
 enabled boolean NOT NULL DEFAULT true,
 builtin boolean NOT NULL DEFAULT false,
 position integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='award' AND threshold IS NOT NULL AND direction IS NULL)
     OR (kind='record' AND direction IS NOT NULL AND threshold IS NULL))
);
CREATE INDEX game_rules_image ON game_rules(image_id) WHERE image_id IS NOT NULL;

INSERT INTO game_rules(key,kind,subject,metric,comparison,threshold,direction,category,min_distance_km,keywords,name,description,builtin,position) VALUES
 -- Awards: stay with everyone who met the condition.
 ('first_public','award','user','public_bikes','gte',1,NULL,NULL,NULL,'{}','Первый выход','Опубликовать первый велосипед',true,10),
 ('full_build','award','bike','build_parts','gte',21,NULL,NULL,NULL,'{}','Сборка до винтика','Фото и полный набор компонентов по правилам площадки',true,20),
 ('wireless','award','bike','keywords','gte',1,NULL,NULL,NULL,'{di2,axs,etap}','Без проводов','Беспроводное переключение в комплектации: Di2, AXS или eTap',true,30),
 ('bike_likes_10','award','bike','likes','gte',10,NULL,NULL,NULL,'{}','10 сердец','10 лайков на одном велосипеде',true,40),
 ('bike_likes_50','award','bike','likes','gte',50,NULL,NULL,NULL,'{}','50 сердец','50 лайков на одном велосипеде',true,50),
 ('bike_likes_100','award','bike','likes','gte',100,NULL,NULL,NULL,'{}','100 сердец','100 лайков на одном велосипеде',true,60),
 ('owner_likes_100','award','user','owner_likes','gte',100,NULL,NULL,NULL,'{}','Любимец витрины','100 лайков публичных велосипедов',true,70),
 ('followers_10','award','user','followers','gte',10,NULL,NULL,NULL,'{}','10 попутчиков','10 подписчиков',true,80),
 ('followers_50','award','user','followers','gte',50,NULL,NULL,NULL,'{}','50 попутчиков','50 подписчиков',true,90),
 ('all_categories','award','user','categories','gte',3,NULL,NULL,NULL,'{}','Без границ','Публичные велосипеды трёх категорий',true,100),
 ('discussion_20','award','user','discussions','gte',20,NULL,NULL,NULL,'{}','В теме','Обсудить 20 разных публичных велосипедов других владельцев',true,110),
 ('century','award','ride','ride_distance','gte',100,NULL,NULL,NULL,'{}','Сотка','Проехать 100 км за одну покатушку',true,120),
 ('mountain_goat','award','ride','ride_elevation','gte',1000,NULL,NULL,NULL,'{}','Горный козёл','Набрать 1000 м высоты за одну покатушку',true,130),
 ('racer','award','ride','ride_max_speed','gte',50,NULL,NULL,NULL,'{}','Гонщик','Разогнаться до 50 км/ч в покатушке, где владелец показывает максимальную скорость',true,140),
 ('all_year','award','user','months_in_year','gte',12,NULL,NULL,NULL,'{}','Круглый год','Покатушки в каждом месяце одного календарного года',true,150),
 ('chronicler','award','user','journal_entries','gte',10,NULL,NULL,NULL,'{}','Летописец','Опубликовать 10 записей журнала',true,160),
 ('mechanic','award','user','service_entries','gte',10,NULL,NULL,NULL,'{}','Механик','Опубликовать 10 записей об обслуживании',true,170),
 -- Records: one holder at a time, and it can change.
 ('expensive','record','bike','price','gte',NULL,'max',NULL,NULL,'{}','Без компромиссов','Самый дорогой байк среди участников рейтинга.',true,10),
 ('budget','record','bike','price','gte',NULL,'min',NULL,NULL,'{}','Бюджетный герой','Самый недорогой байк среди участников рейтинга.',true,20),
 ('lightest_mtb','record','bike','weight','gte',NULL,'min','mtb',NULL,'{}','Легче ветра · MTB','Самый лёгкий MTB среди участников рейтинга.',true,30),
 ('lightest_gravel','record','bike','weight','gte',NULL,'min','gravel',NULL,'{}','Легче ветра · GRAVEL','Самый лёгкий гравийник среди участников рейтинга.',true,40),
 ('lightest_road','record','bike','weight','gte',NULL,'min','road',NULL,'{}','Легче ветра · ROAD','Самый лёгкий шоссейный байк среди участников рейтинга.',true,50),
 ('heavy','record','bike','weight','gte',NULL,'max',NULL,NULL,'{}','Тяжеловоз','Самый тяжёлый велосипед среди участников рейтинга.',true,60),
 ('veteran','record','bike','year','gte',NULL,'min',NULL,NULL,'{}','Ветеран','Самый старый велосипед по модельному году.',true,70),
 ('upgrade','record','bike','upgrade','gte',NULL,'max',NULL,NULL,'{}','На максималках','Самый высокий показатель прокаченности сборки.',true,80),
 ('complete','record','bike','completeness','gte',NULL,'max',NULL,NULL,'{}','Каждая деталь на месте','Самая полная карточка по правилам площадки.',true,90),
 ('marathon','record','ride','ride_distance','gte',NULL,'max',NULL,NULL,'{}','Марафонец','Самая длинная покатушка.',true,100),
 ('climber','record','ride','ride_elevation','gte',NULL,'max',NULL,NULL,'{}','Альпинист','Самый большой набор высоты за покатушку.',true,110),
 ('turtle','record','ride','ride_avg_speed','gte',NULL,'min',NULL,10,'{}','Черепаха','Самая низкая средняя скорость на покатушке от 10 км.',true,120),
 ('mileage_30d','record','user','distance_30d','gte',NULL,'max',NULL,NULL,'{}','Наматыватель','Больше всех километров за последние 30 дней.',true,130),
 ('popular','record','bike','likes','gte',NULL,'max',NULL,NULL,'{}','Любимец публики','Байк с наибольшим числом лайков.',true,140),
 ('wild','record','bike','wild','gte',NULL,'max',NULL,NULL,'{}','Безумная сборка','Больше всего реакций «Безумие».',true,150),
 ('clean','record','bike','clean','gte',NULL,'max',NULL,NULL,'{}','Чистая работа','Больше всего реакций «Чистая сборка».',true,160),
 ('dream','record','bike','dream','gte',NULL,'max',NULL,NULL,'{}','Велосипед мечты','Больше всего реакций «Хочу такой».',true,170),
 ('community','record','bike','community','gte',NULL,'max',NULL,NULL,'{}','Выбор сообщества','Больше всего участников с дополнительными реакциями на байк.',true,180);

-- «Сборка до винтика» keeps the component target the site used for it.
UPDATE game_rules SET threshold = (SELECT (value->'scoring'->>'componentTarget')::numeric FROM site_settings
  WHERE id=1 AND value->'scoring'->>'componentTarget' ~ '^[0-9]{1,3}$')
 WHERE key='full_build' AND EXISTS(SELECT 1 FROM site_settings
  WHERE id=1 AND value->'scoring'->>'componentTarget' ~ '^[0-9]{1,3}$');

-- The administrator's illustrations, descriptions and switched-off records
-- move from the settings JSON into the rules.
UPDATE game_rules g SET image_id = (s.value->m.field->>g.key)::uuid
  FROM gamification_settings s,
       (VALUES ('record','recordImages'),('award','achievementImages')) m(kind,field)
 WHERE s.id=1 AND m.kind=g.kind
   AND s.value->m.field->>g.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND EXISTS(SELECT 1 FROM site_assets a WHERE a.id::text = s.value->m.field->>g.key);
UPDATE game_rules g SET description = left(btrim(s.value->m.field->>g.key), 160)
  FROM gamification_settings s,
       (VALUES ('record','recordDescriptions'),('award','achievementDescriptions')) m(kind,field)
 WHERE s.id=1 AND m.kind=g.kind AND btrim(coalesce(s.value->m.field->>g.key,'')) <> '';
UPDATE game_rules g SET enabled = (s.value->'enabledRecords') ? g.key
  FROM gamification_settings s
 WHERE s.id=1 AND g.kind='record' AND jsonb_typeof(s.value->'enabledRecords')='array'
   AND g.key IN ('expensive','budget','lightest_mtb','lightest_gravel','lightest_road','popular','upgrade','complete','wild','clean','dream','community');

-- The catalog of verified metrics. Only public data counts: public bikes and
-- rides of owners who are not blocked, published public journal entries; a
-- ride's maximum speed only when its owner shows it.
CREATE FUNCTION game_bike_values(p_metric text, p_category text, p_keywords text[], p_owner uuid)
RETURNS TABLE(bike_id uuid, user_id uuid, value numeric) LANGUAGE sql STABLE AS $$
 SELECT b.id, b.owner_id, (CASE p_metric
   WHEN 'likes' THEN (SELECT count(*) FROM bike_likes l JOIN users v ON v.id=l.user_id
     WHERE l.bike_id=b.id AND NOT v.blocked AND l.user_id<>b.owner_id)
   WHEN 'build_parts' THEN CASE WHEN EXISTS(SELECT 1 FROM photos p WHERE p.bike_id=b.id) THEN
     (SELECT count(DISTINCT trim(lower(regexp_replace(normalize(c.category,NFKC),'[^[:alnum:]]+',' ','g')))||'|'||trim(lower(regexp_replace(normalize(c.name,NFKC),'[^[:alnum:]]+',' ','g'))))
        FROM components c WHERE c.bike_id=b.id AND c.section='build' AND trim(c.name)<>'') ELSE 0 END
   WHEN 'keywords' THEN CASE WHEN cardinality(p_keywords)=0 THEN 0 ELSE
     (SELECT count(*) FROM components c WHERE c.bike_id=b.id AND trim(c.name)<>''
        AND c.name ~* ('\m(' || array_to_string(p_keywords,'|') || ')\M')) END
  END)::numeric
  FROM bikes b JOIN users u ON u.id=b.owner_id
 WHERE b.is_public AND NOT u.blocked
   AND (p_owner IS NULL OR b.owner_id=p_owner)
   AND (p_category IS NULL OR b.category=p_category)
$$;

CREATE FUNCTION game_ride_values(p_metric text, p_category text, p_min_distance_km numeric, p_owner uuid)
RETURNS TABLE(ride_id uuid, bike_id uuid, user_id uuid, value numeric) LANGUAGE sql STABLE AS $$
 SELECT r.id, r.bike_id, r.owner_id, v.value
  FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id
  CROSS JOIN LATERAL (SELECT (CASE p_metric
    WHEN 'ride_distance' THEN r.distance_m/1000.0
    WHEN 'ride_elevation' THEN r.elevation_gain_m
    WHEN 'ride_avg_speed' THEN r.avg_speed_mps*3.6
    WHEN 'ride_max_speed' THEN CASE WHEN r.visible_metrics ? 'maxSpeedMps'
      AND jsonb_typeof(r.import_metrics->'maxSpeedMps')='number'
      THEN (r.import_metrics->>'maxSpeedMps')::numeric*3.6 END
   END)::numeric AS value) v
 WHERE r.is_public AND b.is_public AND NOT u.blocked AND r.status='completed'
   -- A planned ride without a track shows no distance on its page.
   AND NOT (r.source_kind='planned' AND NOT r.has_track)
   AND (p_owner IS NULL OR r.owner_id=p_owner)
   AND (p_category IS NULL OR b.category=p_category)
   AND r.distance_m >= coalesce(p_min_distance_km,0)*1000
   AND v.value > 0
$$;

CREATE FUNCTION game_user_values(p_metric text, p_category text, p_owner uuid)
RETURNS TABLE(user_id uuid, value numeric) LANGUAGE sql STABLE AS $$
 WITH rides_public AS (
  SELECT r.owner_id, r.distance_m, coalesce(r.started_at, r.created_at) AS at
    FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id
   WHERE p_metric IN ('rides_count','distance_30d','months_in_year')
     AND r.is_public AND b.is_public AND NOT u.blocked AND r.status='completed'
     AND NOT (r.source_kind='planned' AND NOT r.has_track)
     AND (p_owner IS NULL OR r.owner_id=p_owner)
     AND (p_category IS NULL OR b.category=p_category))
 SELECT owner_id, count(*)::numeric FROM rides_public
  WHERE p_metric='rides_count' GROUP BY owner_id
 UNION ALL
 SELECT owner_id, sum(distance_m)/1000.0 FROM rides_public
  WHERE p_metric='distance_30d' AND at > now()-interval '30 days' GROUP BY owner_id
 UNION ALL
 SELECT owner_id, max(months)::numeric FROM (
   SELECT owner_id, count(DISTINCT extract(month FROM at)) months FROM rides_public
    WHERE p_metric='months_in_year' GROUP BY owner_id, extract(year FROM at)) y
  GROUP BY owner_id
 UNION ALL
 SELECT e.owner_id, count(*)::numeric
   FROM journal_entries e JOIN bikes b ON b.id=e.bike_id JOIN users u ON u.id=e.owner_id
  WHERE p_metric IN ('journal_entries','service_entries')
    AND e.status='published' AND e.is_public AND b.is_public AND NOT u.blocked
    AND e.kind<>'article' AND (p_metric='journal_entries' OR e.kind='service')
    AND (p_owner IS NULL OR e.owner_id=p_owner)
    AND (p_category IS NULL OR b.category=p_category)
  GROUP BY e.owner_id
 UNION ALL
 SELECT b.owner_id, CASE WHEN p_metric='public_bikes' THEN count(*) ELSE count(DISTINCT b.category) END::numeric
   FROM bikes b JOIN users u ON u.id=b.owner_id
  WHERE p_metric IN ('public_bikes','categories') AND b.is_public AND NOT u.blocked
    AND (p_owner IS NULL OR b.owner_id=p_owner)
    AND (p_category IS NULL OR p_metric='categories' OR b.category=p_category)
  GROUP BY b.owner_id
 UNION ALL
 SELECT b.owner_id, count(*)::numeric
   FROM bike_likes l JOIN bikes b ON b.id=l.bike_id JOIN users v ON v.id=l.user_id JOIN users u ON u.id=b.owner_id
  WHERE p_metric='owner_likes' AND b.is_public AND NOT v.blocked AND NOT u.blocked AND l.user_id<>b.owner_id
    AND (p_owner IS NULL OR b.owner_id=p_owner)
  GROUP BY b.owner_id
 UNION ALL
 SELECT f.following_id, count(*)::numeric
   FROM user_follows f JOIN users v ON v.id=f.follower_id JOIN users u ON u.id=f.following_id
  WHERE p_metric='followers' AND NOT v.blocked AND NOT u.blocked
    AND (p_owner IS NULL OR f.following_id=p_owner)
  GROUP BY f.following_id
 UNION ALL
 SELECT c.author_id, count(DISTINCT c.bike_id)::numeric
   FROM bike_comments c JOIN bikes b ON b.id=c.bike_id JOIN users o ON o.id=b.owner_id JOIN users u ON u.id=c.author_id
  WHERE p_metric='discussions' AND c.deleted_at IS NULL AND b.is_public AND b.owner_id<>c.author_id
    AND NOT o.blocked AND NOT u.blocked
    AND (p_owner IS NULL OR c.author_id=p_owner)
  GROUP BY c.author_id
$$;

-- Event-time awards from the enabled rules. A crossed threshold stays: the
-- award is kept when the condition stops holding.
CREATE OR REPLACE FUNCTION cola_award_user(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r game_rules%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,11));
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=uid AND NOT blocked) THEN RETURN; END IF;
 FOR r IN SELECT * FROM game_rules WHERE kind='award' AND enabled ORDER BY position,key LOOP
  IF r.subject='bike' THEN
   INSERT INTO achievement_awards(achievement_key,user_id,bike_id)
   SELECT r.key,uid,v.bike_id FROM game_bike_values(r.metric,r.category,r.keywords,uid) v
    WHERE CASE WHEN r.comparison='lte' THEN v.value<=r.threshold ELSE v.value>=r.threshold END
   ON CONFLICT DO NOTHING;
  ELSIF r.subject='ride' THEN
   INSERT INTO achievement_awards(achievement_key,user_id)
   SELECT r.key,uid WHERE EXISTS(SELECT 1 FROM game_ride_values(r.metric,r.category,r.min_distance_km,uid) v
    WHERE CASE WHEN r.comparison='lte' THEN v.value<=r.threshold ELSE v.value>=r.threshold END)
   ON CONFLICT DO NOTHING;
  ELSE
   INSERT INTO achievement_awards(achievement_key,user_id)
   SELECT r.key,uid FROM game_user_values(r.metric,r.category,uid) v
    WHERE CASE WHEN r.comparison='lte' THEN v.value<=r.threshold ELSE v.value>=r.threshold END
   ON CONFLICT DO NOTHING;
  END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION cola_award_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid uuid;
BEGIN
 IF TG_TABLE_NAME IN ('bikes','rides','journal_entries') THEN uid:=NEW.owner_id;
 ELSIF TG_TABLE_NAME='user_follows' THEN uid:=NEW.following_id;
 ELSIF TG_TABLE_NAME='bike_comments' THEN uid:=NEW.author_id;
 ELSE SELECT owner_id INTO uid FROM bikes WHERE id=NEW.bike_id;
 END IF;
 PERFORM cola_award_user(uid); RETURN NEW;
END $$;
CREATE TRIGGER awards_ride AFTER INSERT OR UPDATE ON rides FOR EACH ROW EXECUTE FUNCTION cola_award_event();
CREATE TRIGGER awards_journal AFTER INSERT OR UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION cola_award_event();

-- New awards for what people have already done.
SELECT cola_award_user(id) FROM users WHERE NOT blocked;
