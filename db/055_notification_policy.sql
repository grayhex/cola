-- #341 (N1.2): the policy that decides which events reach a person, when and
-- through which channel. Settings live in notification_settings (054), the
-- rest below.

-- A group is what one author does to one object in one quarter of an hour: the
-- comments of a thread, say. It is not the identity of an event. The first
-- notice of a group keeps the old dedup_key (the group's own key), a later
-- event of a group whose newest notice was already read gets a notice of its
-- own (key = group + event id), and one that is still unread is folded into
-- that notice (it points at the newest comment). NULL on older rows: their
-- dedup_key is their group.
ALTER TABLE notifications ADD COLUMN group_key text;
CREATE INDEX notifications_group ON notifications(recipient_id,group_key,created_at DESC,id) WHERE group_key IS NOT NULL;

-- What a person allows, when, and from whom. All of it is about the channels
-- that interrupt (e-mail and, once it exists, push); the bell inside the site
-- always has everything a person may see.
--
-- time_zone: IANA name of the person's own clock, the one quiet hours are read
--   in. NULL until the person (or their phone) says it; quiet hours cannot be
--   switched on without it.
-- quiet_*: minutes from local midnight; from > to wraps over midnight. While
--   the window is open an external message waits for its end, unless it would
--   expire first, in which case it is dropped, not sent in the morning.
-- quiet_cancel: the person's explicit choice that the cancellation of a ride
--   they confirmed, close to its start, may break the quiet. Never the default.
-- paused_until: a pause silences the external channels; messages of that time
--   are not caught up afterwards.
-- circle: whose new plans and intents come to the person: mutual follows
--   ('friends', the default), everyone they follow, the people they picked
--   (notification_circle_members), or nobody.
-- considering: also tell about intents still marked "considering" (default no).
ALTER TABLE notification_settings
 ADD COLUMN time_zone text CHECK(time_zone IS NULL OR length(time_zone) BETWEEN 1 AND 64),
 ADD COLUMN quiet_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN quiet_from smallint NOT NULL DEFAULT 1320 CHECK(quiet_from BETWEEN 0 AND 1439),
 ADD COLUMN quiet_to smallint NOT NULL DEFAULT 420 CHECK(quiet_to BETWEEN 0 AND 1439),
 ADD COLUMN quiet_cancel boolean NOT NULL DEFAULT false,
 ADD COLUMN paused_until timestamptz,
 ADD COLUMN circle text NOT NULL DEFAULT 'friends' CHECK(circle IN ('friends','follows','selected','off')),
 ADD COLUMN considering boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT notification_quiet_complete CHECK(NOT quiet_enabled OR (time_zone IS NOT NULL AND quiet_from<>quiet_to));

CREATE TABLE notification_circle_members (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 member_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,member_id),
 CHECK(user_id<>member_id)
);
CREATE INDEX notification_circle_by_member ON notification_circle_members(member_id,user_id);

-- A mute silences, for one person: an author (everything they cause), a ride
-- (everything about it) or a discussion (the comments under one object). The
-- target is a bare id: the server never says whether it exists or is visible,
-- and nothing here widens what a person may see.
CREATE TABLE notification_mutes (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('author','ride','discussion')),
 target_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,kind,target_id)
);

-- Why an e-mail was not sent, for the three new reasons: the person muted what
-- it was about, paused the channel, or the quiet hours outlasted its life; and
-- 'disabled' for the switch of the admin.
ALTER TABLE notification_email_outbox DROP CONSTRAINT notification_email_outbox_error_code_check;
ALTER TABLE notification_email_outbox ADD CONSTRAINT notification_email_outbox_error_code_check
 CHECK (error_code IN ('expired','unavailable','preferences','rate_limit','smtp_temporary','smtp_permanent','attempts_exhausted','muted','paused','quiet','disabled'));

-- New plans and intents of the people a person follows (#341). The notice is an
-- inbox record like any other; `external` says whether it may also leave the
-- site: the budget of discovery messages (a few a day, and not twice from one
-- author in a row) is spent when the notice is made, so that a late or
-- expired suggestion is never caught up in a flood.
ALTER TABLE notifications ADD COLUMN intent_id uuid REFERENCES ride_intents(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN external boolean NOT NULL DEFAULT true;
CREATE INDEX notifications_discovery ON notifications(recipient_id,created_at DESC) WHERE type IN ('plan_published','intent_published');

DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='notifications'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%type%' LOOP
  EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I',c.conname);
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT %I CHECK((%s) OR type IN (''plan_published'',''intent_published''))',c.conname,substring(c.definition FROM 8 FOR length(c.definition)-8));
 END LOOP;
END $$;
-- A plan is about a ride and its date, an intent about an intent; both come from a person.
ALTER TABLE notifications ADD CONSTRAINT notifications_discovery_shape CHECK(type NOT IN ('plan_published','intent_published') OR (
 actor_id IS NOT NULL AND bike_id IS NULL AND comment_id IS NULL AND ride_comment_id IS NULL AND entry_id IS NULL AND entry_comment_id IS NULL
 AND component_id IS NULL AND component_comment_id IS NULL AND listing_id IS NULL
 AND ((type='plan_published' AND ride_id IS NOT NULL AND intent_id IS NULL AND event_occurs_at IS NOT NULL AND event_revision IS NOT NULL)
   OR (type='intent_published' AND intent_id IS NOT NULL AND ride_id IS NULL))));
ALTER TABLE notifications ADD CONSTRAINT notifications_intent_only CHECK(intent_id IS NULL OR type='intent_published');

-- One announcement of a source per class of readiness: that row is the whole
-- memory of "this was already said", so switching private/public, saving again
-- or going back and forth between "considering" and "ready" says nothing twice.
-- The fan-out walks the author's audience in bounded pages: `cursor` is the
-- last recipient done, a worker that dies leaves the lease to run out and the
-- next one continues from there.
CREATE TABLE notification_fanouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('plan_published','intent_published')),
 source_id uuid NOT NULL,
 author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 considering boolean NOT NULL DEFAULT false,
 occurs_at timestamptz,
 revision integer,
 cursor uuid,
 handled integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','cancelled')),
 lease_token uuid,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 UNIQUE(kind,source_id,considering),
 CHECK(kind<>'plan_published' OR (occurs_at IS NOT NULL AND revision IS NOT NULL AND NOT considering))
);
CREATE INDEX notification_fanouts_due ON notification_fanouts(created_at,id) WHERE status='pending';
CREATE INDEX notification_fanouts_author ON notification_fanouts(author_id,created_at DESC);

-- The limits of discovery and the kill switches, one row, with the values the
-- issue proposes. The admin edits them (version is the optimistic lock): a
-- switch off for all e-mail and push, or for one category of them. The bell
-- inside the site is not governed by it. Without a row the defaults apply.
CREATE TABLE notification_limits (
 id smallint PRIMARY KEY CHECK(id=1),
 discovery_per_day smallint NOT NULL DEFAULT 3 CHECK(discovery_per_day BETWEEN 0 AND 20),
 author_cooldown_minutes integer NOT NULL DEFAULT 360 CHECK(author_cooldown_minutes BETWEEN 0 AND 10080),
 announcements_per_author_day smallint NOT NULL DEFAULT 10 CHECK(announcements_per_author_day BETWEEN 1 AND 100),
 audience_max integer NOT NULL DEFAULT 5000 CHECK(audience_max BETWEEN 1 AND 100000),
 batch smallint NOT NULL DEFAULT 200 CHECK(batch BETWEEN 1 AND 1000),
 discovery_enabled boolean NOT NULL DEFAULT true,
 external_enabled boolean NOT NULL DEFAULT true,
 disabled_categories text[] NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 1 CHECK(version>=1),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO notification_limits(id) VALUES(1);
