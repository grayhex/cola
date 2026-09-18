-- Existing sizes stay unknown until the explicit filesystem recalculation job.
ALTER TABLE photos ADD COLUMN size_bytes bigint CHECK(size_bytes >= 0);
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(expires_at);
CREATE INDEX IF NOT EXISTS showcase_category_order ON bikes(category,created_at DESC,id) WHERE is_public=true;
