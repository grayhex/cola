-- Existing plans keep their public meeting point. New plans choose participants
-- in the domain create path; completed personal activities are unchanged.
ALTER TABLE rides ADD COLUMN plan_passport jsonb NOT NULL DEFAULT '{}'
 CHECK (jsonb_typeof(plan_passport)='object');
ALTER TABLE rides ADD COLUMN meeting_visibility text NOT NULL DEFAULT 'public'
 CHECK (meeting_visibility IN ('public','participants'));
ALTER TABLE rides ADD COLUMN plan_ends_at timestamptz;
ALTER TABLE rides ADD CONSTRAINT ride_plan_end CHECK
 (plan_ends_at IS NULL OR (started_at IS NOT NULL AND plan_ends_at>started_at AND plan_ends_at<=started_at+interval '168 hours'));
