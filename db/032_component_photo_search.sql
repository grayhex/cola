ALTER TABLE component_photos ADD COLUMN source jsonb;
ALTER TABLE component_photos ADD CONSTRAINT component_photo_source_object CHECK (source IS NULL OR jsonb_typeof(source)='object');
CREATE TABLE component_photo_candidates (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 model_id uuid NOT NULL REFERENCES component_models(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes'
);
CREATE INDEX component_photo_candidates_expiry ON component_photo_candidates(expires_at);
