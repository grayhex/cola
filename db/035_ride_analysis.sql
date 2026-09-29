-- Bounded derived data, loaded only by the ride detail endpoint, never feeds.
-- Public rows contain only visible coordinates and relative time. Sensor fields
-- are further filtered against the current visible_metrics on every response.
CREATE TABLE ride_analysis (
 ride_id uuid PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
 version integer NOT NULL,
 source_hash text NOT NULL,
 privacy_enabled boolean NOT NULL,
 privacy_radius_m integer NOT NULL,
 owner_series jsonb NOT NULL,
 public_series jsonb NOT NULL
);
