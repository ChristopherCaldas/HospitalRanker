-- CMS suppressed Hybrid_HWR for every hospital in the 2026-09-30 release
-- (footnote 4). Back the readmission category with the heart failure
-- readmission rate instead; keep ingesting Hybrid_HWR in case it returns.
UPDATE measures SET category = NULL WHERE measure_id = 'Hybrid_HWR';

INSERT INTO measures (measure_id, dataset_id, category, name, higher_is_better, unit) VALUES
  ('READM_30_HF', '632h-zaca', 'readmission', '30-day heart failure readmission rate', false, 'percent');

-- Which measures a release was ingested with, so adding a measure re-ingests
-- the current release instead of treating it as already done.
ALTER TABLE cms_releases ADD COLUMN measure_ids text[] NOT NULL DEFAULT '{}';

UPDATE cms_releases r SET measure_ids = (
  SELECT coalesce(array_agg(DISTINCT s.measure_id ORDER BY s.measure_id), '{}')
  FROM measure_scores s WHERE s.release_id = r.id
);
