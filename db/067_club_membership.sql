ALTER TABLE club_memberships ADD COLUMN invite_expires_at timestamptz;
ALTER TABLE clubs ADD COLUMN transfer_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE clubs ADD COLUMN transfer_expires_at timestamptz;
ALTER TABLE clubs ADD COLUMN transfer_revision integer NOT NULL DEFAULT 0;
CREATE INDEX club_active_badges ON club_memberships(user_id,badge_order,club_id) WHERE state='active' AND badge_visible;
ALTER TABLE club_audit ADD COLUMN target_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
