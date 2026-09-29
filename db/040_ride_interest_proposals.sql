-- #234: the minimum to measure the "interest → plan → invitation" funnel.
-- A plan remembers that the organizer proposed it from a group of interest,
-- an invitation that it was sent to someone whose intent fitted. Neither keeps
-- a copy of the intent, its windows, notes or the group it came from.
ALTER TABLE rides ADD COLUMN proposed_from_interest boolean NOT NULL DEFAULT false;
ALTER TABLE ride_invitations ADD COLUMN source text NOT NULL DEFAULT 'direct'
  CHECK(source IN ('direct','interest'));
