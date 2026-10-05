-- #343 (N3.3): the rides near a person, said once and for a reason.
-- A new public plan reaches a person who turned "rides near me" on (059) as a
-- notice of its own type, `plan_nearby`, of its own category, `nearby`: the
-- person can silence it without silencing their friends' plans. If the author
-- is also in the person's circle there is still one notice, the friends' one,
-- and `reasons` says both. The reasons are what the person is told ("a friend's
-- new plan", "in the area you chose", "at the time of your intention"); they
-- name no place and no distance.
ALTER TABLE notifications ADD COLUMN reasons text[] NOT NULL DEFAULT '{}'
 CHECK(reasons <@ ARRAY['friend','nearby','intent']::text[]);

DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='notifications'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%market_expiring%' LOOP
  EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I',c.conname);
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT %I CHECK((%s) OR type IN (''plan_nearby''))',c.conname,substring(c.definition FROM 8 FOR length(c.definition)-8));
 END LOOP;
END $$;

-- A nearby plan is a plan: a ride and its date, from a person.
ALTER TABLE notifications DROP CONSTRAINT notifications_discovery_shape;
ALTER TABLE notifications ADD CONSTRAINT notifications_discovery_shape CHECK(type NOT IN ('plan_published','intent_published','plan_nearby') OR (
 actor_id IS NOT NULL AND bike_id IS NULL AND comment_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL
 AND component_id IS NULL AND component_comment_id IS NULL AND listing_id IS NULL
 AND ((type IN ('plan_published','plan_nearby') AND ride_id IS NOT NULL AND intent_id IS NULL AND event_occurs_at IS NOT NULL AND event_revision IS NOT NULL)
   OR (type='intent_published' AND intent_id IS NOT NULL AND ride_id IS NULL))));
ALTER TABLE notifications ADD CONSTRAINT notifications_nearby_reason CHECK(type<>'plan_nearby' OR reasons @> ARRAY['nearby']::text[]);

DROP INDEX notifications_discovery;
CREATE INDEX notifications_discovery ON notifications(recipient_id,created_at DESC) WHERE type IN ('plan_published','intent_published','plan_nearby');
