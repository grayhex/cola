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
-- it was about, paused the channel, or the quiet hours outlasted its life.
ALTER TABLE notification_email_outbox DROP CONSTRAINT notification_email_outbox_error_code_check;
ALTER TABLE notification_email_outbox ADD CONSTRAINT notification_email_outbox_error_code_check
 CHECK (error_code IN ('expired','unavailable','preferences','rate_limit','smtp_temporary','smtp_permanent','attempts_exhausted','muted','paused','quiet'));
