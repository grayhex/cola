-- One real planned ride, one creator/bicycle and one club; no duplicate RSVP.
ALTER TABLE rides ADD COLUMN club_id uuid REFERENCES clubs(id) ON DELETE RESTRICT;
ALTER TABLE rides ADD COLUMN club_audience text CHECK(club_audience IN ('open','members'));
ALTER TABLE rides ADD COLUMN club_suspended boolean NOT NULL DEFAULT false;
ALTER TABLE rides ADD CONSTRAINT rides_club_shape CHECK(
 (club_id IS NULL AND club_audience IS NULL AND NOT club_suspended)
 OR (club_id IS NOT NULL AND club_audience IS NOT NULL AND source_kind='planned'
   AND ((club_audience='members' AND NOT is_public) OR (club_audience='open' AND is_public))));
CREATE INDEX club_rides_page ON rides(club_id,started_at DESC,id) WHERE club_id IS NOT NULL;

-- Work for the common inbox is queued without user FK locks while the club is
-- locked. Delivery resolves current recipients/roles and never stores names,
-- meeting points or geometry. Provider/channel work is a later migration.
CREATE TABLE club_event_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('organizer_lost','club_archived')),
 actor_id uuid,ride_id uuid REFERENCES rides(id) ON DELETE CASCADE,
 revision bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),delivered_at timestamptz,
 UNIQUE(club_id,kind,ride_id,revision)
);
CREATE INDEX club_event_outbox_pending ON club_event_outbox(created_at,id) WHERE delivered_at IS NULL;

CREATE FUNCTION club_member_ride_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE departing boolean; lost_role boolean; changed record;
BEGIN
 departing := TG_OP='DELETE' OR (OLD.state='active' AND NEW.state<>'active');
 lost_role := departing OR (OLD.state='active' AND OLD.role IN ('owner','admin','organizer') AND NEW.role NOT IN ('owner','admin','organizer'));
 IF departing THEN
   DELETE FROM ride_rsvps v USING rides r WHERE r.id=v.ride_id AND r.club_id=OLD.club_id AND r.club_audience='members' AND v.user_id=OLD.user_id AND v.occurs_at>now();
   DELETE FROM ride_invitations i USING rides r WHERE r.id=i.ride_id AND r.club_id=OLD.club_id AND r.club_audience='members' AND i.user_id=OLD.user_id;
   UPDATE notifications n SET cancelled_at=coalesce(cancelled_at,now()) FROM rides r WHERE r.id=n.ride_id AND r.club_id=OLD.club_id AND r.club_audience='members' AND n.recipient_id=OLD.user_id AND (n.event_occurs_at IS NULL OR n.event_occurs_at>now());
 END IF;
 IF lost_role THEN
   FOR changed IN UPDATE rides SET club_suspended=true,updated_at=now() WHERE club_id=OLD.club_id AND owner_id=OLD.user_id AND status='planned' AND (recurrence='weekly' OR started_at>now()) AND NOT club_suspended RETURNING id,agreement_revision LOOP
     INSERT INTO club_event_outbox(club_id,kind,actor_id,ride_id,revision) VALUES(OLD.club_id,'organizer_lost',OLD.user_id,changed.id,OLD.revision+1) ON CONFLICT DO NOTHING;
   END LOOP;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER club_member_ride_lifecycle BEFORE DELETE OR UPDATE OF state,role ON club_memberships FOR EACH ROW EXECUTE FUNCTION club_member_ride_lifecycle();

-- OG/canonical URLs use the same public envelope as ride collections.
CREATE OR REPLACE VIEW public_entity_links AS
SELECT 'bike'::text kind,b.id entity_id,b.share_id legacy_id,b.public_id,b.slug,b.owner_id,b.is_public
  FROM bikes b JOIN users u ON u.id=b.owner_id WHERE NOT u.blocked
UNION ALL
SELECT 'journal',e.id,e.share_id,e.public_id,e.slug,e.owner_id,
  e.status='published' AND e.is_public AND b.is_public
  FROM journal_entries e JOIN bikes b ON b.id=e.bike_id JOIN users u ON u.id=e.owner_id WHERE NOT u.blocked
UNION ALL
SELECT 'ride',r.id,r.share_id,r.public_id,r.slug,r.owner_id,r.is_public AND b.is_public AND (r.club_id IS NULL OR (r.club_audience='open' AND b.owner_id=r.owner_id AND (r.status<>'planned' OR (r.recurrence='none' AND r.started_at<=now()) OR NOT b.is_former) AND EXISTS(SELECT 1 FROM clubs c LEFT JOIN users co ON co.id=c.owner_id WHERE c.id=r.club_id AND c.hidden_at IS NULL AND (c.owner_id IS NULL OR NOT co.blocked))))
  FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id WHERE NOT u.blocked
UNION ALL
SELECT 'market',m.id,m.share_id,m.public_id,m.slug,m.owner_id,m.status IN ('active','sold')
  FROM market_listings m JOIN users u ON u.id=m.owner_id WHERE NOT u.blocked
UNION ALL
SELECT 'profile',u.id,u.id,u.public_id,u.slug,u.id,true
  FROM users u WHERE NOT u.blocked AND u.username IS NOT NULL;

-- Existing public records/achievement metrics must exclude hidden clubs too.
CREATE OR REPLACE FUNCTION game_ride_values(p_metric text, p_category text, p_min_distance_km numeric, p_owner uuid)
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
 WHERE r.is_public AND (r.club_id IS NULL OR (r.club_audience='open' AND b.owner_id=r.owner_id AND (r.status<>'planned' OR (r.recurrence='none' AND r.started_at<=now()) OR NOT b.is_former) AND EXISTS(SELECT 1 FROM clubs c LEFT JOIN users co ON co.id=c.owner_id WHERE c.id=r.club_id AND c.hidden_at IS NULL AND (c.owner_id IS NULL OR NOT co.blocked)))) AND b.is_public AND NOT u.blocked AND r.status='completed'
   -- A planned ride without a track shows no distance on its page.
   AND NOT (r.source_kind='planned' AND NOT r.has_track)
   AND (p_owner IS NULL OR r.owner_id=p_owner)
   AND (p_category IS NULL OR b.category=p_category)
   AND r.distance_m >= coalesce(p_min_distance_km,0)*1000
   AND v.value > 0
$$;

CREATE OR REPLACE FUNCTION game_user_values(p_metric text, p_category text, p_owner uuid)
RETURNS TABLE(user_id uuid, value numeric) LANGUAGE sql STABLE AS $$
 WITH rides_public AS (
  SELECT r.owner_id, r.distance_m, coalesce(r.started_at, r.created_at) AS at
    FROM rides r JOIN bikes b ON b.id=r.bike_id JOIN users u ON u.id=r.owner_id
   WHERE p_metric IN ('rides_count','distance_30d','months_in_year')
     AND r.is_public AND (r.club_id IS NULL OR (r.club_audience='open' AND b.owner_id=r.owner_id AND (r.status<>'planned' OR (r.recurrence='none' AND r.started_at<=now()) OR NOT b.is_former) AND EXISTS(SELECT 1 FROM clubs c LEFT JOIN users co ON co.id=c.owner_id WHERE c.id=r.club_id AND c.hidden_at IS NULL AND (c.owner_id IS NULL OR NOT co.blocked)))) AND b.is_public AND NOT u.blocked AND r.status='completed'
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


-- Blocking an account does not leave its future internal participation alive
-- for a later unblock, or keep collecting people for its club events.
CREATE FUNCTION club_blocked_user_rides() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid uuid; changed record;
BEGIN
 IF NOT NEW.blocked OR OLD.blocked=NEW.blocked THEN RETURN NEW; END IF;
 FOR cid IN SELECT DISTINCT club_id FROM rides WHERE club_id IS NOT NULL AND (owner_id=NEW.id OR id IN (SELECT ride_id FROM ride_rsvps WHERE user_id=NEW.id UNION SELECT ride_id FROM ride_invitations WHERE user_id=NEW.id)) ORDER BY club_id LOOP
   PERFORM 1 FROM clubs WHERE id=cid FOR UPDATE;
 END LOOP;
 DELETE FROM ride_rsvps v USING rides r WHERE v.ride_id=r.id AND r.club_id IS NOT NULL AND r.club_audience='members' AND v.user_id=NEW.id AND v.occurs_at>now();
 DELETE FROM ride_invitations i USING rides r WHERE i.ride_id=r.id AND r.club_id IS NOT NULL AND r.club_audience='members' AND i.user_id=NEW.id;
 UPDATE notifications n SET cancelled_at=coalesce(cancelled_at,now()) FROM rides r WHERE r.id=n.ride_id AND r.club_id IS NOT NULL AND r.club_audience='members' AND n.recipient_id=NEW.id AND (n.event_occurs_at IS NULL OR n.event_occurs_at>now());
 FOR changed IN UPDATE rides SET club_suspended=true,updated_at=now() WHERE club_id IS NOT NULL AND owner_id=NEW.id AND status='planned' AND (recurrence='weekly' OR started_at>now()) AND NOT club_suspended RETURNING id,club_id,agreement_revision LOOP
   INSERT INTO club_event_outbox(club_id,kind,actor_id,ride_id,revision) VALUES(changed.club_id,'organizer_lost',NEW.id,changed.id,floor(extract(epoch FROM clock_timestamp())*1000000)::bigint) ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER club_blocked_user_rides AFTER UPDATE OF blocked ON users FOR EACH ROW EXECUTE FUNCTION club_blocked_user_rides();
