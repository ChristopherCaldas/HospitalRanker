-- ZIP code (ZCTA) internal points from the Census Gazetteer, for the
-- "near you" search (services/nearby.ts). Hospitals are located at their own
-- ZIP's point, so distances are ZIP to ZIP: close enough to say which
-- hospitals are within 25 miles, not for turn-by-turn directions.
-- Loaded by `npm run ingest:zips` (ingest/zips.ts).
CREATE TABLE zip_points (
  zip  char(5) PRIMARY KEY,
  lat  float8  NOT NULL,
  lon  float8  NOT NULL
);

-- Hospital Information lists ZIP+4 for a few hospitals; match on the first five.
CREATE VIEW hospital_points AS
SELECT h.facility_id, z.lat, z.lon
FROM hospitals h
JOIN zip_points z ON z.zip = substring(h.zip_code FROM '^\d{5}');
