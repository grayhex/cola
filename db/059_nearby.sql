-- #343 (N3.2): the private area of "rides near me". A separate consent (off
-- until the person turns it on), not a field of the public profile and not a
-- published intention. One row per account: the last coarse area only, never a
-- history of places; a device-derived area expires (24 hours by default) and is
-- not renewed by anything but the phone confirming a new one.
CREATE TABLE nearby_areas (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 source text CHECK(source IN ('manual','device')),
 label text CHECK(label IS NULL OR char_length(label) BETWEEN 1 AND 100),
 -- The centre of a grid cell (lib/nearby.ts), never a point the person was at.
 area_lng numeric(8,5) CHECK(area_lng BETWEEN -180 AND 180),
 area_lat numeric(8,5) CHECK(area_lat BETWEEN -90 AND 90),
 radius_m integer CHECK(radius_m BETWEEN 1000 AND 100000),
 observed_at timestamptz,
 expires_at timestamptz,
 horizon_days integer NOT NULL DEFAULT 14 CHECK(horizon_days BETWEEN 1 AND 30),
 filters jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((source IS NULL)=(area_lng IS NULL)),
 CHECK((area_lng IS NULL)=(area_lat IS NULL)),
 CHECK((area_lng IS NULL)=(radius_m IS NULL)),
 CHECK((area_lng IS NULL)=(observed_at IS NULL)),
 -- A device area always ends; a manual one lasts until it is removed.
 CHECK(source IS DISTINCT FROM 'device' OR expires_at IS NOT NULL));
-- The cleanup reads only what has a term, the matching only what is on and kept.
CREATE INDEX nearby_areas_expiry ON nearby_areas(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX nearby_areas_active ON nearby_areas(area_lat,area_lng) WHERE enabled AND area_lat IS NOT NULL;

-- Operator limits and the kill switch of the area (bounds, never a way to force
-- a person's consent): the biggest radius, how long a device area lives.
ALTER TABLE notification_limits
 ADD COLUMN nearby_enabled boolean NOT NULL DEFAULT true,
 ADD COLUMN nearby_max_radius_km integer NOT NULL DEFAULT 50 CHECK(nearby_max_radius_km BETWEEN 5 AND 100),
 ADD COLUMN nearby_device_ttl_hours integer NOT NULL DEFAULT 24 CHECK(nearby_device_ttl_hours BETWEEN 1 AND 72);
