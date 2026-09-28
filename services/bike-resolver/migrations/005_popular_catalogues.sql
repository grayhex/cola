-- 002 creates version 1; 003 advances untouched settings to version 2.
-- Operator saves advance the version, so their disabled adapters stay disabled.
UPDATE bike_resolver.settings
SET value = jsonb_set(jsonb_set(value, '{adapters,trek}', 'true'::jsonb), '{adapters,cannondale}', 'true'::jsonb),
    version = version + 1
WHERE id = 1 AND version = 2;
