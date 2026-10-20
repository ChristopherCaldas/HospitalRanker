-- Score history from CMS's archived snapshots (ingest/archive.ts), so each
-- hospital's measures can be shown as a trend.

-- 'live' = the current CSV from the metastore; 'archive' = a CSV inside a
-- past snapshot zip. Archive releases are always older than the dataset's
-- live release, so "latest release" logic is unchanged.
ALTER TABLE cms_releases ADD COLUMN source text NOT NULL DEFAULT 'live'
  CHECK (source IN ('live', 'archive'));

-- One score per hospital x measure x measurement period. A period can appear
-- in several releases (CMS republishes unchanged data, sometimes corrected);
-- the newest release wins.
CREATE VIEW measure_score_history AS
SELECT DISTINCT ON (s.facility_id, s.measure_id, s.end_date)
       s.facility_id, s.measure_id, s.start_date, s.end_date, s.score,
       s.lower_estimate, s.higher_estimate, s.denominator, r.released, r.source
FROM measure_scores s
JOIN cms_releases r ON r.id = s.release_id
WHERE r.status = 'complete' AND s.score IS NOT NULL AND s.end_date IS NOT NULL
ORDER BY s.facility_id, s.measure_id, s.end_date, r.released DESC, r.id DESC;

-- Trend lookups go by hospital, which the primary key can't serve.
CREATE INDEX measure_scores_facility_idx ON measure_scores (facility_id, measure_id);
