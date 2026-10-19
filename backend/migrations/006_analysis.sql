-- Strain/spend vs. outcomes analysis.
--
-- The *_live views compute everything from current data. `npm run analyze`
-- freezes them into the snapshot tables (keyed by analysis_runs) whenever the
-- inputs change, because CDC revises past weeks in place. The analysis_latest_*
-- views expose the newest snapshot to the API and Power BI.

-- Scope for state-level comparisons: 50 states + DC. Territories are left out:
-- PR is 96% Medicare Advantage, and the rest have too few hospitals.
CREATE VIEW analysis_states AS
SELECT unnest(ARRAY[
  'AK','AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','HI','IA','ID','IL','IN','KS',
  'KY','LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ','NM','NV',
  'NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VA','VT','WA','WI','WV','WY'
]) AS state;

-- Per category measure: the release analysed (newest complete release with
-- scores, as in the rankings API) and the period its scores cover.
CREATE VIEW analysis_measure_windows AS
SELECT DISTINCT ON (s.measure_id)
       s.measure_id, s.release_id, r.released,
       min(s.start_date) AS window_start, max(s.end_date) AS window_end
FROM measure_scores s
JOIN cms_releases r ON r.id = s.release_id
JOIN measures m ON m.measure_id = s.measure_id
WHERE s.score IS NOT NULL AND r.status = 'complete' AND m.category IS NOT NULL
GROUP BY s.measure_id, s.release_id, r.released, r.id
ORDER BY s.measure_id, r.released DESC NULLS LAST, r.id DESC;

-- State outcome = case-weighted mean of hospital scores. PSI_90 publishes no
-- denominators, so it falls back to an unweighted mean (weight 1).
CREATE VIEW analysis_state_outcomes AS
SELECT w.measure_id, w.release_id, h.state,
       count(*) AS hospitals,
       sum(s.denominator) AS cases,
       sum(s.score * coalesce(s.denominator, 1)) / sum(coalesce(s.denominator, 1)) AS outcome
FROM analysis_measure_windows w
JOIN measure_scores s ON s.measure_id = w.measure_id AND s.release_id = w.release_id AND s.score IS NOT NULL
JOIN hospitals h ON h.facility_id = s.facility_id
JOIN analysis_states a ON a.state = h.state
GROUP BY w.measure_id, w.release_id, h.state;

-- Strain averaged over the weeks inside each measure's window. A week is used
-- only if at least half the state's hospitals reported and occupancy is a
-- plausible <= 100%, which drops most of the voluntary May-Oct 2024 period.
-- Respiratory admissions are COVID + flu (RSV was voluntary until Nov 2024).
CREATE VIEW analysis_state_strain AS
SELECT w.measure_id, x.jurisdiction AS state,
       count(*) AS weeks_in_window,
       count(*) FILTER (WHERE u.usable) AS weeks_used,
       avg(x.pct_inpatient_occupied) FILTER (WHERE u.usable) AS avg_inpatient_occupancy,
       avg(x.pct_icu_occupied) FILTER (WHERE u.usable AND x.pct_icu_occupied <= 100) AS avg_icu_occupancy,
       avg(100.0 * (x.covid_admissions + x.flu_admissions) / nullif(x.inpatient_beds, 0))
         FILTER (WHERE u.usable AND x.pct_admissions_coverage >= 50) AS avg_resp_admissions_per_100_beds
FROM analysis_measure_windows w
JOIN state_weekly_strain x ON x.week_ending BETWEEN w.window_start AND w.window_end
JOIN analysis_states a ON a.state = x.jurisdiction
CROSS JOIN LATERAL (
  SELECT coalesce(x.pct_inpatient_coverage >= 50 AND x.pct_inpatient_occupied <= 100, false) AS usable
) u
GROUP BY w.measure_id, x.jurisdiction;

-- Spend averaged over the calendar years overlapping each window, weighted by
-- days of overlap. Windows can run past the latest spend year; spend_days
-- vs window_days shows how much of the window is covered.
CREATE VIEW analysis_state_spend AS
SELECT w.measure_id, sp.state::text AS state,
       sum(sp.total_stdzd_pymt_pc * o.days) / sum(o.days) AS stdzd_spend_pc,
       sum(sp.ip_stdzd_pymt_pc * o.days) / sum(o.days) AS ip_stdzd_spend_pc,
       sum(sp.ma_participation_rate * o.days) / sum(o.days) AS ma_participation_rate,
       sum(sp.dual_eligible_pct * o.days) / sum(o.days) AS dual_eligible_pct,
       sum(o.days) AS spend_days,
       w.window_end - w.window_start + 1 AS window_days
FROM analysis_measure_windows w
JOIN state_medicare_spend sp
  ON make_date(sp.year, 1, 1) <= w.window_end AND make_date(sp.year, 12, 31) >= w.window_start
JOIN analysis_states a ON a.state = sp.state
CROSS JOIN LATERAL (
  SELECT least(make_date(sp.year, 12, 31), w.window_end) - greatest(make_date(sp.year, 1, 1), w.window_start) + 1 AS days
) o
GROUP BY w.measure_id, sp.state, w.window_start, w.window_end;

-- One row per measure x state: outcome alongside the strain and spend it is
-- compared with.
CREATE VIEW analysis_state_measure_live AS
SELECT o.measure_id, o.release_id, w.window_start, w.window_end, o.state,
       m.higher_is_better, o.hospitals, o.cases, o.outcome,
       st.weeks_in_window, st.weeks_used, st.avg_inpatient_occupancy, st.avg_icu_occupancy,
       st.avg_resp_admissions_per_100_beds,
       sp.stdzd_spend_pc, sp.ip_stdzd_spend_pc, sp.ma_participation_rate, sp.dual_eligible_pct,
       sp.spend_days, sp.window_days
FROM analysis_state_outcomes o
JOIN analysis_measure_windows w ON w.measure_id = o.measure_id
JOIN measures m ON m.measure_id = o.measure_id
LEFT JOIN analysis_state_strain st ON st.measure_id = o.measure_id AND st.state = o.state
LEFT JOIN analysis_state_spend sp ON sp.measure_id = o.measure_id AND sp.state = o.state;

-- Across states, per measure x factor: Pearson r with a 95% CI (Fisher z),
-- Spearman rho (average ranks, so ties are handled), and the partial r
-- controlling for the dual-eligible share as a proxy for patient poverty.
-- p-values use the Fisher z normal approximation; partial_q_value is the
-- Benjamini-Hochberg FDR-adjusted partial p across every test in the view,
-- since 25 tests at alpha 0.05 would produce ~1 false positive by chance.
-- States with fewer than 3 scored hospitals are excluded. The sign of r is in
-- the measure's own units: check higher_is_better before reading it as good/bad.
CREATE VIEW analysis_correlations_live AS
WITH base AS (
  SELECT sm.measure_id, sm.release_id, sm.higher_is_better, sm.outcome, sm.dual_eligible_pct AS z,
         f.factor, f.value
  FROM analysis_state_measure_live sm
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

-- Each hospital's standing within its state and nationally, oriented so a
-- higher percentile is always better.
CREATE VIEW analysis_hospital_percentiles_live AS
SELECT w.measure_id, w.release_id, s.facility_id, h.state, s.score, s.denominator,
       count(*) OVER (PARTITION BY w.measure_id, h.state) AS state_hospitals,
       percent_rank() OVER (PARTITION BY w.measure_id, h.state ORDER BY o.better) AS state_percentile,
       percent_rank() OVER (PARTITION BY w.measure_id ORDER BY o.better) AS national_percentile
FROM analysis_measure_windows w
JOIN measure_scores s ON s.measure_id = w.measure_id AND s.release_id = w.release_id AND s.score IS NOT NULL
JOIN measures m ON m.measure_id = w.measure_id
JOIN hospitals h ON h.facility_id = s.facility_id
CROSS JOIN LATERAL (SELECT CASE WHEN m.higher_is_better THEN s.score ELSE -s.score END AS better) o;

-- Snapshots. `inputs` fingerprints the data a run used (CMS release per
-- measure, CDC and Medicare GV versions) so unchanged inputs aren't re-run.
CREATE TABLE analysis_runs (
  id         serial PRIMARY KEY,
  inputs     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analysis_state_measure AS
SELECT NULL::integer AS run_id, * FROM analysis_state_measure_live WITH NO DATA;
ALTER TABLE analysis_state_measure
  ALTER COLUMN run_id SET NOT NULL,
  ADD FOREIGN KEY (run_id) REFERENCES analysis_runs (id) ON DELETE CASCADE,
  ADD PRIMARY KEY (run_id, measure_id, state);

CREATE TABLE analysis_correlations AS
SELECT NULL::integer AS run_id, * FROM analysis_correlations_live WITH NO DATA;
ALTER TABLE analysis_correlations
  ALTER COLUMN run_id SET NOT NULL,
  ADD FOREIGN KEY (run_id) REFERENCES analysis_runs (id) ON DELETE CASCADE,
  ADD PRIMARY KEY (run_id, measure_id, factor);

CREATE TABLE analysis_hospital_percentiles AS
SELECT NULL::integer AS run_id, * FROM analysis_hospital_percentiles_live WITH NO DATA;
ALTER TABLE analysis_hospital_percentiles
  ALTER COLUMN run_id SET NOT NULL,
  ADD FOREIGN KEY (run_id) REFERENCES analysis_runs (id) ON DELETE CASCADE,
  ADD PRIMARY KEY (run_id, measure_id, facility_id);

CREATE VIEW analysis_latest_state_measure AS
SELECT * FROM analysis_state_measure WHERE run_id = (SELECT max(id) FROM analysis_runs);
CREATE VIEW analysis_latest_correlations AS
SELECT * FROM analysis_correlations WHERE run_id = (SELECT max(id) FROM analysis_runs);
CREATE VIEW analysis_latest_hospital_percentiles AS
SELECT * FROM analysis_hospital_percentiles WHERE run_id = (SELECT max(id) FROM analysis_runs);
