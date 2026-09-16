CREATE TABLE IF NOT EXISTS bike_resolver.settings (
 id integer PRIMARY KEY CHECK(id=1),
 value jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1
);
INSERT INTO bike_resolver.settings(id,value) VALUES(1,'{"enabled":true,"autoResolve":true,"timeoutMs":10000,"requestIntervalMs":700,"successTtlDays":90,"negativeTtlHours":24,"adapters":{"cube":false,"specialized":true,"canyon":true,"giant":true,"trek":false,"cannondale":false,"scott":false,"orbea":false,"merida":false,"bmc":false}}') ON CONFLICT DO NOTHING;
