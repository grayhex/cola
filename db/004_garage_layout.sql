ALTER TABLE bikes ADD COLUMN manufacturer_url text NOT NULL DEFAULT '';
ALTER TABLE bikes ADD COLUMN price numeric(12,2) CHECK(price>=0);
ALTER TABLE bikes ADD COLUMN show_bike_price boolean NOT NULL DEFAULT false;
ALTER TABLE bikes ADD COLUMN show_component_prices boolean NOT NULL DEFAULT false;
ALTER TABLE bikes ADD COLUMN show_accessory_prices boolean NOT NULL DEFAULT false;
ALTER TABLE bikes ADD COLUMN group_order jsonb NOT NULL DEFAULT '[]';
ALTER TABLE components ADD COLUMN url text NOT NULL DEFAULT '';
ALTER TABLE components ADD COLUMN group_id text NOT NULL DEFAULT '';
ALTER TABLE components ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE photos ADD COLUMN source_url text;
ALTER TABLE photos ADD COLUMN source_page_url text;
CREATE UNIQUE INDEX photos_import_source ON photos(bike_id,source_url) WHERE source_url IS NOT NULL;
CREATE TABLE photo_search_candidates (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);
CREATE INDEX photo_search_candidates_expiry ON photo_search_candidates(expires_at);
