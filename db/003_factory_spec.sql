ALTER TABLE bikes ADD COLUMN trim text NOT NULL DEFAULT '';
ALTER TABLE bikes ADD COLUMN factory_spec jsonb;
