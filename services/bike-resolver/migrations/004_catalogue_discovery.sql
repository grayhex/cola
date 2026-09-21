-- Enable improved archive adapters for installations still using untouched defaults.
UPDATE bike_resolver.settings SET value=jsonb_set(value,'{adapters,merida}','true'::jsonb) WHERE version=1;
UPDATE bike_resolver.settings SET value=jsonb_set(value,'{adapters,gt}','true'::jsonb) WHERE NOT(value->'adapters' ? 'gt');
