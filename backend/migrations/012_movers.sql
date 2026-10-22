-- Movers (backend/src/analysis/movers.ts): which hospitals really changed
-- between two separate measurement periods, after sampling noise and
-- regression to the mean, and whether anything predicts who changes.

-- Every yearly cost report since 2017 (ingest/changes.ts), for changes in
-- finances and staffing over time. `file_year` is CMS's file, roughly the
-- fiscal year that began that year. Same columns as hospital_finance.
CREATE TABLE hospital_finance_history (
  file_year integer NOT NULL,
  LIKE hospital_finance INCLUDING DEFAULTS,
  PRIMARY KEY (facility_id, file_year)
);

-- CMS change-of-ownership records (Hospital Change of Ownership), since 2016.
CREATE TABLE hospital_ownership_changes (
  buyer_ccn      text,
  seller_ccn     text,
  effective_date date NOT NULL,
  chow_type      text,
  buyer_name     text,
  seller_name    text
);
CREATE INDEX hospital_ownership_changes_ccn_idx ON hospital_ownership_changes (seller_ccn, buyer_ccn);

-- One row per hospital x measure scored in both periods. Scores in the
-- measure's own units; changes oriented so + = better.
CREATE TABLE analysis_movers (
  run_id         integer NOT NULL REFERENCES analysis_runs (id) ON DELETE CASCADE,
  measure_id     text    NOT NULL REFERENCES measures (measure_id),
  facility_id    text    NOT NULL REFERENCES hospitals (facility_id),
  start_score    float8  NOT NULL,
  end_score      float8  NOT NULL,
  expected_end   float8  NOT NULL, -- what regression to the mean alone predicts from the start score
  change         float8  NOT NULL, -- end - expected_end, shrunk for noise where applicable, oriented
  change_se      float8  NOT NULL,
  verdict        text    NOT NULL CHECK (verdict IN ('improved', 'steady', 'declined')),
  ownership_change boolean NOT NULL, -- CMS recorded a change of ownership between the periods
  PRIMARY KEY (run_id, measure_id, facility_id)
);
CREATE INDEX analysis_movers_facility_idx ON analysis_movers (run_id, facility_id);

-- Per measure: the periods compared, how much changes, regression to the
-- mean by starting fifth, and what predicts change.
CREATE TABLE analysis_mover_models (
  run_id        integer NOT NULL REFERENCES analysis_runs (id) ON DELETE CASCADE,
  measure_id    text    NOT NULL REFERENCES measures (measure_id),
  start_period  daterange NOT NULL,
  end_period    daterange NOT NULL,
  hospitals     integer NOT NULL,
  rtm_slope     float8  NOT NULL, -- end on start: below 1 = pulled back toward the average
  tau           float8  NOT NULL, -- SD of real changes; also the "clear change" margin
  improved      integer NOT NULL,
  declined      integer NOT NULL,
  detectable    integer NOT NULL, -- 95% sure the change isn't zero (looser than improved/declined)
  raw_jumps     integer NOT NULL, -- bottom fifth to top fifth on raw scores
  raw_drops     integer NOT NULL, -- top fifth to bottom fifth
  fifths        jsonb   NOT NULL, -- [{ fifth, hospitals, avgChange, se }] raw oriented change by starting fifth
  predictors    jsonb   NOT NULL, -- { groups: { g: { alone, added } }, variables: { v: { r, n } }, everything }
  ownership     jsonb   NOT NULL, -- { hospitals, effect, se, improved, declined } effect in units of tau
  PRIMARY KEY (run_id, measure_id)
);

CREATE VIEW analysis_latest_movers AS
SELECT * FROM analysis_movers WHERE run_id = (SELECT max(id) FROM analysis_runs);
CREATE VIEW analysis_latest_mover_models AS
SELECT * FROM analysis_mover_models WHERE run_id = (SELECT max(id) FROM analysis_runs);
