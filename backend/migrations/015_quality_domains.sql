-- Every scored quality measure now gets an analysis window, so the expected
-- model, group/domain scores, predictors and movers cover the measures added
-- in 014. The state correlations (and their Benjamini-Hochberg correction)
-- stay limited to the five category measures the States page shows.
CREATE OR REPLACE VIEW analysis_measure_windows AS
SELECT DISTINCT ON (s.measure_id)
       s.measure_id, s.release_id, r.released,
       min(s.start_date) AS window_start, max(s.end_date) AS window_end
FROM measure_scores s
JOIN cms_releases r ON r.id = s.release_id
JOIN measures m ON m.measure_id = s.measure_id
WHERE s.score IS NOT NULL AND r.status = 'complete' AND (m.category IS NOT NULL OR m.quality_group IS NOT NULL)
GROUP BY s.measure_id, s.release_id, r.released, r.id
ORDER BY s.measure_id, r.released DESC NULLS LAST, r.id DESC;

CREATE OR REPLACE VIEW analysis_correlations_live AS
WITH base AS (
  SELECT sm.measure_id, sm.release_id, sm.higher_is_better, sm.outcome, sm.dual_eligible_pct AS z,
         f.factor, f.value
  FROM analysis_state_measure_live sm
  JOIN measures m ON m.measure_id = sm.measure_id AND m.category IS NOT NULL
  CROSS JOIN LATERAL (VALUES
    ('inpatient_occupancy', sm.avg_inpatient_occupancy),
    ('icu_occupancy', sm.avg_icu_occupancy),
    ('resp_admissions_per_100_beds', sm.avg_resp_admissions_per_100_beds),
    ('stdzd_spend_pc', sm.stdzd_spend_pc),
    ('ip_stdzd_spend_pc', sm.ip_stdzd_spend_pc)
  ) AS f (factor, value)
  WHERE sm.hospitals >= 3 AND f.value IS NOT NULL AND sm.outcome IS NOT NULL AND sm.dual_eligible_pct IS NOT NULL
),
ranked AS (
  SELECT b.*,
         (rank() OVER g_value + count(*) OVER g + 1 - rank() OVER g_value_desc) / 2.0 AS value_rank,
         (rank() OVER g_outcome + count(*) OVER g + 1 - rank() OVER g_outcome_desc) / 2.0 AS outcome_rank
  FROM base b
  WINDOW g AS (PARTITION BY measure_id, factor),
         g_value AS (g ORDER BY value), g_value_desc AS (g ORDER BY value DESC),
         g_outcome AS (g ORDER BY outcome), g_outcome_desc AS (g ORDER BY outcome DESC)
),
stats AS (
  SELECT measure_id, release_id, higher_is_better, factor,
         count(*) AS n,
         corr(outcome, value) AS r,
         corr(outcome_rank, value_rank) AS spearman,
         corr(value, z) AS r_xz,
         corr(outcome, z) AS r_yz,
         regr_slope(outcome, value) AS slope,
         regr_r2(outcome, value) AS r2
  FROM ranked
  GROUP BY measure_id, release_id, higher_is_better, factor
),
partial AS (
  SELECT s.*,
         (s.r - s.r_xz * s.r_yz) / nullif(sqrt((1 - s.r_xz ^ 2) * (1 - s.r_yz ^ 2)), 0) AS partial_r
  FROM stats s
),
tested AS (
  SELECT p.*,
         CASE WHEN n > 3 AND abs(r) < 1 THEN erfc(abs(atanh(r)) * sqrt(n - 3) / sqrt(2)) END AS p_value,
         CASE WHEN n > 4 AND abs(partial_r) < 1 THEN erfc(abs(atanh(partial_r)) * sqrt(n - 4) / sqrt(2)) END AS partial_p_value
  FROM partial p
),
bh AS (
  SELECT t.*,
         t.partial_p_value * count(t.partial_p_value) OVER ()
           / rank() OVER (ORDER BY t.partial_p_value NULLS LAST) AS bh_raw
  FROM tested t
)
SELECT measure_id, release_id, higher_is_better, factor, n, r,
       CASE WHEN n > 3 AND abs(r) < 1 THEN tanh(atanh(r) - 1.96 / sqrt(n - 3)) END AS r_ci_low,
       CASE WHEN n > 3 AND abs(r) < 1 THEN tanh(atanh(r) + 1.96 / sqrt(n - 3)) END AS r_ci_high,
       p_value,
       spearman,
       partial_r,
       CASE WHEN n > 4 AND abs(partial_r) < 1 THEN tanh(atanh(partial_r) - 1.96 / sqrt(n - 4)) END AS partial_r_ci_low,
       CASE WHEN n > 4 AND abs(partial_r) < 1 THEN tanh(atanh(partial_r) + 1.96 / sqrt(n - 4)) END AS partial_r_ci_high,
       partial_p_value,
       least(1, min(bh_raw) OVER (ORDER BY partial_p_value DESC NULLS FIRST
                                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) AS partial_q_value,
       slope, r2
FROM bh;

-- Group, domain and overall scores per hospital (analysis/scores.ts). scope
-- is 'overall', a domain ('outcome', 'process') or a CMS measure group. Scores
-- are weighted means of each measure's shrunk gap in its tau units (1 = one
-- SD of real hospital-to-hospital spread), + is better.
-- analysis_hospital_composite keeps the overall score for the existing pages.
CREATE TABLE analysis_hospital_scores (
  run_id        integer NOT NULL REFERENCES analysis_runs (id) ON DELETE CASCADE,
  scope         text    NOT NULL,
  facility_id   text    NOT NULL,
  state         char(2) NOT NULL,
  measures      integer NOT NULL,
  groups        integer NOT NULL,
  score         float8  NOT NULL,
  score_se      float8  NOT NULL,
  verdict       text    NOT NULL,
  national_rank integer NOT NULL,
  state_rank    integer NOT NULL,
  PRIMARY KEY (run_id, scope, facility_id)
);

CREATE VIEW analysis_latest_hospital_scores AS
SELECT * FROM analysis_hospital_scores WHERE run_id = (SELECT max(id) FROM analysis_runs);

-- Donabedian's chain, tested on the expected-model gaps (so fair context is
-- already accounted for): structure -> process, process -> outcome,
-- structure -> outcome with and without process held constant, and curated
-- clinical process/outcome pairs (analysis/chain.ts).
CREATE TABLE analysis_chain (
  run_id      integer NOT NULL REFERENCES analysis_runs (id) ON DELETE CASCADE,
  link        text    NOT NULL,   -- 'structure_process', 'process_outcome', 'structure_outcome', 'pair'
  x           text    NOT NULL,   -- structure variable, process measure/scope
  y           text    NOT NULL,   -- process or outcome measure/scope
  n           integer NOT NULL,
  r           float8,
  r_ci_low    float8,
  r_ci_high   float8,
  spearman    float8,
  partial_r   float8,             -- structure_outcome: holding the process score constant
  q_value     float8,             -- Benjamini-Hochberg over the run's chain tests
  top_fifth   float8,             -- mean y among hospitals in the best fifth of x
  bottom_fifth float8,            -- mean y among hospitals in the worst fifth of x
  PRIMARY KEY (run_id, link, x, y)
);

CREATE VIEW analysis_latest_chain AS
SELECT * FROM analysis_chain WHERE run_id = (SELECT max(id) FROM analysis_runs);
