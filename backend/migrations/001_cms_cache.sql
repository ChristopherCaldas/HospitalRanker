-- Interim replacement for data/cache.json. Superseded once the
-- hospitals / measure_scores ingestion schema lands.
CREATE TABLE cms_cache (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
