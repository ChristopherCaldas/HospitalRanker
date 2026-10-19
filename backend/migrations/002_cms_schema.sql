-- Release-aware CMS storage. Every CMS release is kept so scores can be
-- compared across releases; the API reads the latest complete one.

-- One row per (dataset, published CSV). CMS gives each release a new download
-- URL, so the URL is the release identity.
CREATE TABLE cms_releases (
  id           serial PRIMARY KEY,
  dataset_id   text NOT NULL,                -- e.g. 'ynj2-r877'
  title        text NOT NULL,
  download_url text NOT NULL UNIQUE,
  modified     date,                         -- metastore "modified"
  released     date,                         -- metastore "released"
  status       text NOT NULL DEFAULT 'ingesting'
               CHECK (status IN ('ingesting', 'complete', 'failed')),
  row_count    integer,
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX cms_releases_dataset_idx ON cms_releases (dataset_id, released DESC);

-- Latest known attributes per hospital (from Hospital General Information,
-- or minimal name/location from a measure file if a hospital is missing there).
CREATE TABLE hospitals (
  facility_id        text PRIMARY KEY,
  name               text NOT NULL,
  address            text,
  city               text,
  state              char(2),
  zip_code           text,
  county             text,
  phone              text,
  hospital_type      text,
  ownership          text,
  emergency_services boolean,
  overall_rating     smallint CHECK (overall_rating BETWEEN 1 AND 5),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hospitals_state_idx ON hospitals (state);

-- Which CMS measures we ingest, and how to read them. Ingestion is driven by
-- this table, so adding a measure is an INSERT here.
CREATE TABLE measures (
  measure_id       text PRIMARY KEY,         -- CMS measure id
  dataset_id       text NOT NULL,
  category         text UNIQUE,              -- app category it backs, if any
  name             text NOT NULL,
  higher_is_better boolean NOT NULL,
  unit             text NOT NULL
);

INSERT INTO measures (measure_id, dataset_id, category, name, higher_is_better, unit) VALUES
  ('OP_18b',               'yv7e-xc69', 'wait_times',   'Median time in the ED before leaving',          false, 'minutes'),
  ('MORT_30_AMI',          'ynj2-r877', 'mortality',    '30-day heart attack mortality rate',            false, 'percent'),
  ('PSI_90',               'ynj2-r877', 'safety',       'PSI 90 patient safety composite',               false, 'ratio'),
  ('H_COMP_1_STAR_RATING', 'dgck-syfz', 'satisfaction', 'Nurse communication star rating (HCAHPS)',      true,  'stars'),
  ('Hybrid_HWR',           '632h-zaca', 'readmission',  'Hospital-wide 30-day unplanned readmission rate', false, 'percent');

-- One row per hospital x measure x release. Unavailable scores are kept
-- (score NULL, footnote explains why) so data coverage can be reported.
CREATE TABLE measure_scores (
  release_id           integer NOT NULL REFERENCES cms_releases (id) ON DELETE CASCADE,
  facility_id          text    NOT NULL REFERENCES hospitals (facility_id),
  measure_id           text    NOT NULL REFERENCES measures (measure_id),
  score                numeric,
  lower_estimate       numeric,
  higher_estimate      numeric,
  denominator          integer,              -- cases, sample or completed surveys
  compared_to_national text,
  footnote             text,
  start_date           date,                 -- the period the score covers
  end_date             date,
  PRIMARY KEY (release_id, facility_id, measure_id)
);
CREATE INDEX measure_scores_measure_idx ON measure_scores (measure_id, release_id);

-- Scores from the most recent complete release of each measure's dataset.
CREATE VIEW latest_measure_scores AS
SELECT s.*, r.released
FROM measure_scores s
JOIN cms_releases r ON r.id = s.release_id
WHERE r.id = (
  SELECT r2.id FROM cms_releases r2
  WHERE r2.dataset_id = r.dataset_id AND r2.status = 'complete'
  ORDER BY r2.released DESC NULLS LAST, r2.id DESC
  LIMIT 1
);

-- The interim JSON-blob cache is replaced by the tables above.
DROP TABLE cms_cache;
