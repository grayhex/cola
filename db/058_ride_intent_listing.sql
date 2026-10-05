-- #343 (N3.1): the community list of intentions for API v1 is read newest first
-- with a cursor, from the intentions anyone signed in may see. Only those rows
-- are indexed, so the list never scans the private and the ended ones.
CREATE INDEX ride_intents_community ON ride_intents(created_at DESC,id)
 WHERE visibility='community' AND status='active';
