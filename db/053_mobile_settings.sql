-- Settings of the native apps (#338), apart from the web appearance. `value`
-- is what an admin edits; the revisions are kept by the server: each holds the
-- settings version that last changed that block, so an app can tell a new
-- edition of onboarding or a notice from one it has already shown.
CREATE TABLE mobile_settings (
 id integer PRIMARY KEY CHECK(id=1), value jsonb NOT NULL DEFAULT '{}'::jsonb,
 version integer NOT NULL DEFAULT 1,
 onboarding_revision integer NOT NULL DEFAULT 1,
 notice_revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO mobile_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
