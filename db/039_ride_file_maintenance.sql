-- #248: ride file maintenance runs outside HTTP requests in bounded batches.
-- Batched reference checks of queued and orphan files by their file key.
CREATE INDEX rides_track_file ON rides(track_file_id) WHERE track_file_id IS NOT NULL;
-- The durable GC queue is drained oldest first.
CREATE INDEX ride_file_gc_created ON ride_file_gc(created_at);
-- Where the next bounded orphan pass continues (a file name, '' = start).
CREATE TABLE maintenance_cursors(
  name text PRIMARY KEY,
  position text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
