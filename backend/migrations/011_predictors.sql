-- "What predicts hospital results?" (backend/src/analysis/predictors.ts):
-- which hospital facts predict actual published scores, snapshotted per
-- analysis run. Unlike the expected-score model, any fact is fair game here,
-- including finances, staffing and past scores, because the question is what
-- goes with good results, not what to grade on a curve.

-- Health-system membership (AHRQ Compendium of U.S. Health Systems,
-- hospital linkage file).
ALTER TABLE hospital_context
  ADD COLUMN system_id        text,
  ADD COLUMN system_name      text,
  ADD COLUMN system_hospitals integer;  -- hospitals in the system (1 = independent)

-- More cost-report lines: volume and the balance sheet.
ALTER TABLE hospital_finance
  ADD COLUMN total_discharges    float8,
  ADD COLUMN investments         float8,
  ADD COLUMN total_assets        float8,
  ADD COLUMN total_liabilities   float8,
  ADD COLUMN current_assets      float8,
  ADD COLUMN current_liabilities float8,
  ADD COLUMN fixed_assets        float8;

CREATE OR REPLACE VIEW hospital_finance_ratios AS
SELECT f.facility_id, f.fiscal_year_end, f.beds,
       f.net_income_patient / NULLIF(f.net_patient_revenue, 0)                         AS patient_margin,
       f.net_income / NULLIF(f.net_patient_revenue + coalesce(f.total_other_income, 0), 0) AS total_margin,
       f.total_other_income / NULLIF(f.net_patient_revenue, 0)                         AS other_income_share,
       f.uncompensated_care / NULLIF(f.total_costs, 0)                                 AS uncompensated_share,
       f.medicaid_days / NULLIF(f.total_days, 0)                                       AS medicaid_day_share,
       f.medicare_days / NULLIF(f.total_days, 0)                                       AS medicare_day_share,
       f.total_days / NULLIF(f.bed_days_available, 0)                                  AS occupancy,
       f.fte_employees / NULLIF(f.beds, 0)                                             AS fte_per_bed,
       f.contract_labor / NULLIF(f.salaries, 0)                                        AS contract_labor_share,
       f.total_costs / NULLIF(f.total_discharges, 0)                                   AS cost_per_discharge,
       f.total_liabilities / NULLIF(f.total_assets, 0)                                 AS debt_ratio,
       f.current_assets / NULLIF(f.current_liabilities, 0)                             AS current_ratio,
       f.investments / NULLIF(f.beds, 0)                                               AS investments_per_bed,
       f.fixed_assets / NULLIF(f.beds, 0)                                              AS fixed_assets_per_bed,
       f.salaries / NULLIF(f.fte_employees, 0)                                         AS salary_per_fte
FROM hospital_finance f;

-- Per measure: how much of the differences between hospitals each group of
-- predictors explains (5-fold cross-validated R^2), alone and on top of all
-- the others, plus each variable's simple correlation with the score.
CREATE TABLE analysis_predictors (
  run_id     integer NOT NULL REFERENCES analysis_runs (id) ON DELETE CASCADE,
  measure_id text    NOT NULL REFERENCES measures (measure_id),
  hospitals  integer NOT NULL,
  groups     jsonb   NOT NULL, -- { group: { alone, added } }  (added = R^2 lost when dropped from everything)
  variables  jsonb   NOT NULL, -- { variable: { r, n, coverage } }  r oriented: + = goes with better scores
  models     jsonb   NOT NULL, -- { assumptions, fair_context, everything_known, with_track_record }: R^2 cv
  noise_share float8,          -- share of score variance that is sampling noise (raw measures only)
  PRIMARY KEY (run_id, measure_id)
);

-- How well a hospital's score from an earlier period predicts its current one.
CREATE TABLE analysis_persistence (
  run_id       integer NOT NULL REFERENCES analysis_runs (id) ON DELETE CASCADE,
  measure_id   text    NOT NULL REFERENCES measures (measure_id),
  period_start date,
  period_end   date    NOT NULL,
  years_back   float8  NOT NULL, -- current period end minus this period's end
  overlapping  boolean NOT NULL, -- shares months with the current period (so shares patients)
  r            float8  NOT NULL, -- Pearson, oriented the same way on both sides
  n            integer NOT NULL,
  PRIMARY KEY (run_id, measure_id, period_end)
);

-- Is quality one thing? Correlation between hospitals' scores on two measures
-- (both oriented so + = better).
CREATE TABLE analysis_measure_correlations (
  run_id    integer NOT NULL REFERENCES analysis_runs (id) ON DELETE CASCADE,
  measure_a text    NOT NULL REFERENCES measures (measure_id),
  measure_b text    NOT NULL REFERENCES measures (measure_id),
  r         float8  NOT NULL,
  n         integer NOT NULL,
  PRIMARY KEY (run_id, measure_a, measure_b)
);

CREATE VIEW analysis_latest_predictors AS
SELECT * FROM analysis_predictors WHERE run_id = (SELECT max(id) FROM analysis_runs);
CREATE VIEW analysis_latest_persistence AS
SELECT * FROM analysis_persistence WHERE run_id = (SELECT max(id) FROM analysis_runs);
CREATE VIEW analysis_latest_measure_correlations AS
SELECT * FROM analysis_measure_correlations WHERE run_id = (SELECT max(id) FROM analysis_runs);
