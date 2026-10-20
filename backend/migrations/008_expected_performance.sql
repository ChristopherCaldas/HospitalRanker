-- Context-adjusted ("expected vs. actual") hospital performance, computed by
-- backend/src/analysis/expected.ts during `npm run analyze` and snapshotted
-- per analysis run like the other analysis tables.
--
-- Gaps are oriented so positive always means better than expected.

-- One fitted model per measure per run.
CREATE TABLE analysis_expected_models (
  run_id       integer NOT NULL REFERENCES analysis_runs (id) ON DELETE CASCADE,
  measure_id   text    NOT NULL REFERENCES measures (measure_id),
  -- How each hospital's uncertainty is handled:
  --   shrunk       raw measure; empirical-Bayes shrinkage toward expected
  --   cms_smoothed CMS already shrinks the published rate; binomial SE, no extra shrinkage
  --   cms_interval CMS publishes a 95% interval; SE taken from it
  method       text    NOT NULL CHECK (method IN ('shrunk', 'cms_smoothed', 'cms_interval')),
  hospitals      integer NOT NULL,
  r2             float8  NOT NULL, -- in-sample, weighted
  r2_cv          float8  NOT NULL, -- 5-fold cross-validated: share of differences context explains
  coefficients   jsonb   NOT NULL, -- { predictor: { estimate, se } }
  importance     jsonb   NOT NULL, -- { group: drop in r2_cv when the group is removed }
  rank_agreement float8  NOT NULL, -- Spearman, raw vs adjusted ranking (1 = adjusting changes nothing)
  tau            float8  NOT NULL, -- SD of real hospital-to-hospital differences; also the verdict margin
  noise_k        float8,           -- sampling-noise scale: variance = noise_k / cases (shrunk method)
  PRIMARY KEY (run_id, measure_id)
);

-- One row per hospital x measure with a score and state context.
CREATE TABLE analysis_hospital_expected (
  run_id       integer NOT NULL REFERENCES analysis_runs (id) ON DELETE CASCADE,
  measure_id   text    NOT NULL REFERENCES measures (measure_id),
  facility_id  text    NOT NULL REFERENCES hospitals (facility_id),
  actual       float8  NOT NULL,
  expected     float8  NOT NULL,
  gap          float8  NOT NULL, -- raw, oriented (+ = better than expected)
  adjusted_gap float8  NOT NULL, -- after shrinkage where applicable, oriented
  gap_se       float8  NOT NULL, -- uncertainty of adjusted_gap
  z            float8  NOT NULL,
  verdict      text    NOT NULL CHECK (verdict IN ('better', 'as_expected', 'worse')),
  PRIMARY KEY (run_id, measure_id, facility_id)
);
CREATE INDEX analysis_hospital_expected_facility_idx ON analysis_hospital_expected (run_id, facility_id);

-- Overall context-adjusted score for hospitals with at least 3 measures: the
-- mean of per-measure adjusted gaps, each in units of that measure's tau.
CREATE TABLE analysis_hospital_composite (
  run_id        integer NOT NULL REFERENCES analysis_runs (id) ON DELETE CASCADE,
  facility_id   text    NOT NULL REFERENCES hospitals (facility_id),
  state         text    NOT NULL,
  measures      integer NOT NULL,
  score         float8  NOT NULL,
  score_se      float8  NOT NULL,
  verdict       text    NOT NULL CHECK (verdict IN ('better', 'as_expected', 'worse')),
  national_rank integer NOT NULL,
  state_rank    integer NOT NULL,
  PRIMARY KEY (run_id, facility_id)
);

CREATE VIEW analysis_latest_expected_models AS
SELECT * FROM analysis_expected_models WHERE run_id = (SELECT max(id) FROM analysis_runs);
CREATE VIEW analysis_latest_hospital_expected AS
SELECT * FROM analysis_hospital_expected WHERE run_id = (SELECT max(id) FROM analysis_runs);
CREATE VIEW analysis_latest_hospital_composite AS
SELECT * FROM analysis_hospital_composite WHERE run_id = (SELECT max(id) FROM analysis_runs);
