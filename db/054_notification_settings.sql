-- #341: the account's notification settings that belong to no one channel. The
-- consent to e-mail stays in notification_email_preferences (its queue budget,
-- retry clock and unsubscribe key are the e-mail channel's); this row holds the
-- switches of the other channels and the one switch every channel shares.
--
-- reminders: whether the person wants the reminder of a ride they accepted. It
--   was a column of the e-mail preferences, but the reminder is made for the
--   site first, with or without SMTP; the old column stays in step for one
--   release (the application writes both) and is dropped by a later migration.
-- push_enabled: the account's consent to push. A phone's own permission and
--   registration are a different fact, kept by the device registry.
-- push_categories: explicit choices only, as {"rides":true}; a category that is
--   missing has the default of the catalogue (lib/notification-catalog.ts).
-- updated_at: when the person last changed these settings. It stays NULL while
--   the row exists only so that a change can lock it, because the version of the
--   settings (the ETag of the API) is made of it: creating the row to take the
--   lock must not make a client's version of the defaults stale.
CREATE TABLE notification_settings (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 reminders boolean NOT NULL DEFAULT true,
 push_enabled boolean NOT NULL DEFAULT false,
 push_categories jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(push_categories)='object'),
 updated_at timestamptz
);
-- Only a choice that differs from the default needs a row; it is dated as the
-- e-mail row it came from was.
INSERT INTO notification_settings(user_id,reminders,updated_at)
 SELECT user_id,ride_reminders,updated_at FROM notification_email_preferences WHERE NOT ride_reminders
 ON CONFLICT (user_id) DO NOTHING;
