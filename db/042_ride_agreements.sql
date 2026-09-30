-- #235: one agreement per planned ride and date.
-- A person's answer stays one ride_rsvps row per date. `revision` records the
-- edition of the conditions it was given to: a substantial change of the
-- start, the meeting place or the route starts a new edition, and an earlier
-- "going" or "maybe" then asks for a new confirmation. Existing answers belong
-- to the first edition, so none of them changes meaning here.
ALTER TABLE rides ADD COLUMN agreement_revision integer NOT NULL DEFAULT 1
  CHECK (agreement_revision >= 1);
ALTER TABLE rides ADD COLUMN agreement_changes text[] NOT NULL DEFAULT '{}'
  CHECK (agreement_changes <@ ARRAY['start','place','route']::text[]);
ALTER TABLE rides ADD COLUMN agreement_changed_at timestamptz;
ALTER TABLE ride_rsvps ADD COLUMN revision integer NOT NULL DEFAULT 1
  CHECK (revision >= 1);
-- The organizer stops new sign-ups for one date (the one named here). People
-- who already answered and invited people keep their place; the next date of
-- a weekly series is open again.
ALTER TABLE rides ADD COLUMN recruitment_closed_for timestamptz;
-- One cancelled date of a weekly series; the series and its other dates stay.
-- Keyed by the local date in the series' zone, so a later change of the start
-- time does not bring the cancelled date back.
CREATE TABLE ride_cancelled_occurrences(
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  occurs_on date NOT NULL,
  occurs_at timestamptz NOT NULL,
  cancelled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(ride_id, occurs_on)
);
-- The invitation is an access grant; the answer lives in ride_rsvps only.
COMMENT ON COLUMN ride_invitations.response IS
  'Not maintained since #235: answers are ride_rsvps rows per date';
