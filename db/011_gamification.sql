CREATE TABLE gamification_settings(id integer PRIMARY KEY CHECK(id=1),value jsonb NOT NULL DEFAULT '{}');
INSERT INTO gamification_settings(id) VALUES(1);
ALTER TABLE bikes ADD COLUMN leaderboard_excluded boolean NOT NULL DEFAULT false;
CREATE TABLE bike_reactions(
 bike_id uuid NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('wild','clean','dream')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(bike_id,user_id,kind)
);
CREATE INDEX reactions_user ON bike_reactions(user_id,bike_id);
CREATE TABLE achievement_awards(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 achievement_key text NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 bike_id uuid REFERENCES bikes(id) ON DELETE CASCADE,
 awarded_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX awards_user_once ON achievement_awards(user_id,achievement_key) WHERE bike_id IS NULL;
CREATE UNIQUE INDEX awards_bike_once ON achievement_awards(bike_id,achievement_key) WHERE bike_id IS NOT NULL;
CREATE INDEX awards_owner ON achievement_awards(user_id,awarded_at DESC);
CREATE INDEX record_price ON bikes(price,id) WHERE is_public AND show_bike_price AND NOT leaderboard_excluded;
CREATE INDEX record_weight ON bikes(category,weight,id) WHERE is_public AND NOT leaderboard_excluded;
-- Event-time milestones preserve crossed thresholds. No prices or private snapshots in awards.
CREATE FUNCTION cola_award_user(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n integer; target integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text,11));
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=uid AND NOT blocked) THEN RETURN; END IF;
 SELECT coalesce((value->'scoring'->>'componentTarget')::integer,21) INTO target FROM site_settings WHERE id=1;
 target:=coalesce(target,21);
 INSERT INTO achievement_awards(achievement_key,user_id,bike_id)
 SELECT 'full_build',uid,b.id FROM bikes b WHERE b.owner_id=uid AND b.is_public
 AND EXISTS(SELECT 1 FROM photos WHERE bike_id=b.id)
 AND (SELECT count(DISTINCT trim(lower(regexp_replace(normalize(category,NFKC),'[^[:alnum:]]+',' ','g')))||'|'||trim(lower(regexp_replace(normalize(name,NFKC),'[^[:alnum:]]+',' ','g')))) FROM components WHERE bike_id=b.id AND section='build' AND trim(name)<>'')>=target ON CONFLICT DO NOTHING;
 INSERT INTO achievement_awards(achievement_key,user_id,bike_id)
 SELECT 'bike_likes_'||t.n,uid,b.id FROM bikes b CROSS JOIN (VALUES(10),(50),(100)) t(n)
 WHERE b.owner_id=uid AND b.is_public AND (SELECT count(*) FROM bike_likes l JOIN users u ON u.id=l.user_id WHERE l.bike_id=b.id AND NOT u.blocked AND u.id<>uid)>=t.n ON CONFLICT DO NOTHING;
 INSERT INTO achievement_awards(achievement_key,user_id)
 SELECT key,uid FROM (VALUES
 ('first_public',(SELECT count(*)>=1 FROM bikes WHERE owner_id=uid AND is_public)),
 ('all_categories',(SELECT count(DISTINCT category)>=3 FROM bikes WHERE owner_id=uid AND is_public)),
 ('owner_likes_100',(SELECT count(*)>=100 FROM bike_likes l JOIN bikes b ON b.id=l.bike_id JOIN users u ON u.id=l.user_id WHERE b.owner_id=uid AND b.is_public AND NOT u.blocked AND u.id<>uid)),
 ('followers_10',(SELECT count(*)>=10 FROM user_follows f JOIN users u ON u.id=f.follower_id WHERE f.following_id=uid AND NOT u.blocked)),
 ('followers_50',(SELECT count(*)>=50 FROM user_follows f JOIN users u ON u.id=f.follower_id WHERE f.following_id=uid AND NOT u.blocked)),
 ('discussion_20',(SELECT count(DISTINCT c.bike_id)>=20 FROM bike_comments c JOIN bikes b ON b.id=c.bike_id JOIN users u ON u.id=b.owner_id WHERE c.author_id=uid AND c.deleted_at IS NULL AND b.is_public AND b.owner_id<>uid AND NOT u.blocked))
 ) t(key,earned) WHERE earned ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION cola_award_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid uuid;
BEGIN
 IF TG_TABLE_NAME='bikes' THEN uid:=NEW.owner_id;
 ELSIF TG_TABLE_NAME='user_follows' THEN uid:=NEW.following_id;
 ELSIF TG_TABLE_NAME='bike_comments' THEN uid:=NEW.author_id;
 ELSE SELECT owner_id INTO uid FROM bikes WHERE id=NEW.bike_id;
 END IF;
 PERFORM cola_award_user(uid); RETURN NEW;
END $$;
CREATE TRIGGER awards_bike AFTER INSERT OR UPDATE ON bikes FOR EACH ROW EXECUTE FUNCTION cola_award_event();
CREATE TRIGGER awards_follow AFTER INSERT ON user_follows FOR EACH ROW EXECUTE FUNCTION cola_award_event();
CREATE TRIGGER awards_like AFTER INSERT ON bike_likes FOR EACH ROW EXECUTE FUNCTION cola_award_event();
CREATE TRIGGER awards_comment AFTER INSERT OR UPDATE ON bike_comments FOR EACH ROW EXECUTE FUNCTION cola_award_event();
CREATE TRIGGER awards_component AFTER INSERT OR UPDATE ON components FOR EACH ROW EXECUTE FUNCTION cola_award_event();
CREATE TRIGGER awards_photo AFTER INSERT ON photos FOR EACH ROW EXECUTE FUNCTION cola_award_event();
SELECT cola_award_user(id) FROM users WHERE NOT blocked;
