-- Keep existing threads and composite FKs. Only remove the one-level cap.
-- Parents must predate their children; immutable edges cannot form cycles.

CREATE OR REPLACE FUNCTION check_comment_depth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.bike_id IS DISTINCT FROM OLD.bike_id) THEN
  RAISE EXCEPTION 'Comment thread is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bike_comments WHERE id=NEW.parent_id AND bike_id=NEW.bike_id) THEN
  RAISE EXCEPTION 'Comment parent must already exist in the same entity' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION check_ride_comment_depth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.ride_id IS DISTINCT FROM OLD.ride_id) THEN
  RAISE EXCEPTION 'Comment thread is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ride_comments WHERE id=NEW.parent_id AND ride_id=NEW.ride_id) THEN
  RAISE EXCEPTION 'Comment parent must already exist in the same entity' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION check_journal_comment_depth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.entry_id IS DISTINCT FROM OLD.entry_id) THEN
  RAISE EXCEPTION 'Comment thread is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journal_comments WHERE id=NEW.parent_id AND entry_id=NEW.entry_id) THEN
  RAISE EXCEPTION 'Comment parent must already exist in the same entity' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION check_component_comment_depth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.model_id IS DISTINCT FROM OLD.model_id) THEN
  RAISE EXCEPTION 'Comment thread is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM component_comments WHERE id=NEW.parent_id AND model_id=NEW.model_id) THEN
  RAISE EXCEPTION 'Comment parent must already exist in the same entity' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;
