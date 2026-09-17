-- The previous allowlist must never become a denylist on upgrade.
UPDATE bike_resolver.settings SET value=(value-'manualDomains') || jsonb_build_object('blockedDomains',coalesce(value->'blockedDomains','[]'::jsonb)),version=version+1 WHERE id=1;
