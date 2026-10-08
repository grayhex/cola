-- Removing the backdrop of a bike photo (#370). A photo cleared of its backdrop
-- is a new version with a new media ID; the file it was made of stays next to
-- it, so the owner can go back. `size_bytes` counts both files: the storage
-- quota is the sum of it, and the original is the owner's disk too.
ALTER TABLE photos ADD COLUMN original_filename text UNIQUE;
ALTER TABLE photos ADD COLUMN original_size_bytes bigint CHECK(original_size_bytes >= 0);
ALTER TABLE photos ADD CONSTRAINT photo_original_pair CHECK((original_filename IS NULL) = (original_size_bytes IS NULL));

-- The result of a try, until the owner takes it or it expires. The bytes lie in
-- the media cache directory (derived data: a restart may clear them), the row
-- says whose they are and what they were made of. `photo_id` is the saved photo
-- as it was when the preview was made: its ID changes with every new version,
-- so a preview of an older version never fits a changed photo.
CREATE TABLE photo_previews (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source text NOT NULL CHECK (source IN ('photo','candidate','upload')),
 photo_id uuid,
 candidate_id uuid,
 width integer NOT NULL CHECK (width > 0),
 height integer NOT NULL CHECK (height > 0),
 size_bytes integer NOT NULL CHECK (size_bytes > 0),
 removed real NOT NULL CHECK (removed >= 0 AND removed <= 1),
 -- The photo this preview became: a repeated «apply» answers with it again.
 applied_photo_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 CHECK ((source = 'photo') = (photo_id IS NOT NULL)),
 CHECK ((source = 'candidate') = (candidate_id IS NOT NULL))
);
CREATE INDEX photo_previews_owner ON photo_previews (owner_id, created_at DESC);
CREATE INDEX photo_previews_expiry ON photo_previews (expires_at);
