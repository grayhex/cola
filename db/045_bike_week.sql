CREATE TABLE bike_week_settings(id integer PRIMARY KEY CHECK(id=1), value jsonb NOT NULL DEFAULT '{}');
INSERT INTO bike_week_settings(id) VALUES(1);
-- IDs deliberately survive source deletion: historical audit contains no names,
-- descriptions or photos. Every current read must join live bikes/users.
CREATE TABLE bike_weeks(
 week_start date PRIMARY KEY CHECK(extract(isodow FROM week_start)=1),
 bike_id uuid, owner_id uuid,
 status text NOT NULL CHECK(status IN ('selected','empty','skipped','invalid')),
 source text NOT NULL CHECK(source IN ('automatic','override','skip')),
 metrics jsonb NOT NULL DEFAULT '{}', settings jsonb NOT NULL,
 window_start timestamptz NOT NULL, window_end timestamptz NOT NULL,
 story text NOT NULL DEFAULT '' CHECK(length(story)<=600), story_published_at timestamptz,
 selected_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bike_week_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 week_start date NOT NULL, bike_id uuid, owner_id uuid,
 event text NOT NULL, metrics jsonb NOT NULL DEFAULT '{}',
 actor_id uuid, reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bike_week_cooldown ON bike_week_history(bike_id,week_start DESC) WHERE event='selected';
CREATE TABLE bike_week_declines(week_start date NOT NULL,bike_id uuid NOT NULL,PRIMARY KEY(week_start,bike_id));
CREATE TABLE bike_week_decisions(
 week_start date PRIMARY KEY, action text NOT NULL CHECK(action IN ('override','skip')),
 bike_id uuid, actor_id uuid NOT NULL, reason text NOT NULL,
 CHECK((action='override' AND bike_id IS NOT NULL) OR (action='skip' AND bike_id IS NULL))
);
-- Preserve all existing notification constraints and add an actor-free notice.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint
 WHERE conrelid='notifications'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%type%' LOOP
  EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I',c.conname);
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT %I CHECK ((type<>''bike_week'' AND %s) OR (type=''bike_week'' AND actor_id IS NULL AND bike_id IS NOT NULL AND comment_id IS NULL AND ride_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL AND listing_id IS NULL AND component_id IS NULL AND component_comment_id IS NULL))',c.conname,substring(c.definition from 7));
 END LOOP;
END $$;
CREATE INDEX bike_likes_window ON bike_likes(created_at,bike_id,user_id);
CREATE INDEX bike_reactions_window ON bike_reactions(created_at,bike_id,user_id);
CREATE INDEX bike_discussion_window ON bike_comments(created_at,bike_id,author_id) WHERE deleted_at IS NULL;
CREATE INDEX photos_cover_lookup ON photos(bike_id,is_cover DESC,created_at,id);
