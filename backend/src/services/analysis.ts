import { pool } from '../db/pool'

// Reads the latest analysis snapshot (see migrations/006_analysis.sql) for
// the measure behind a category: one row per state plus the correlations.

export interface StateRow {
  state: string
  hospitals: number
  cases: number | null
  outcome: number
  inpatientOccupancy: number | null
  icuOccupancy: number | null
  respAdmissionsPer100Beds: number | null
  stdzdSpendPc: number | null
  ipStdzdSpendPc: number | null
  maParticipationRate: number | null
  dualEligiblePct: number | null
  weeksUsed: number | null
  weeksInWindow: number | null
}

export interface Correlation {
  factor: string
  n: number
  r: number
  rCiLow: number | null
  rCiHigh: number | null
  spearman: number
  partialR: number | null
  partialCiLow: number | null
  partialCiHigh: number | null
  partialQ: number | null
  slope: number
  intercept: number
}

export interface StateAnalysis {
  runId: number
  runCreatedAt: string
  measureId: string
  higherIsBetter: boolean
  unit: string
  windowStart: string
  windowEnd: string
  nationalOutcome: number
  states: StateRow[]
  correlations: Correlation[]
}

export async function getStateAnalysis(category: string): Promise<StateAnalysis | null> {
  const { rows: [head] } = await pool.query(
    `SELECT r.id AS "runId", to_char(r.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS "runCreatedAt",
            m.measure_id AS "measureId", m.higher_is_better AS "higherIsBetter", m.unit,
            to_char(min(a.window_start), 'YYYY-MM-DD') AS "windowStart",
            to_char(max(a.window_end), 'YYYY-MM-DD') AS "windowEnd",
            (sum(a.outcome * coalesce(a.cases, a.hospitals)) / sum(coalesce(a.cases, a.hospitals)))::float8
              AS "nationalOutcome"
     FROM measures m
     JOIN analysis_latest_state_measure a ON a.measure_id = m.measure_id
     JOIN analysis_runs r ON r.id = a.run_id
     WHERE m.category = $1
     GROUP BY r.id, m.measure_id`,
    [category]
  )
  if (!head) return null

  const [states, correlations] = await Promise.all([
    pool.query<StateRow>(
      `SELECT state, hospitals::int AS hospitals, cases::float8 AS cases, outcome::float8 AS outcome,
              avg_inpatient_occupancy::float8 AS "inpatientOccupancy",
              avg_icu_occupancy::float8 AS "icuOccupancy",
              avg_resp_admissions_per_100_beds::float8 AS "respAdmissionsPer100Beds",
              stdzd_spend_pc::float8 AS "stdzdSpendPc", ip_stdzd_spend_pc::float8 AS "ipStdzdSpendPc",
              ma_participation_rate::float8 AS "maParticipationRate",
              dual_eligible_pct::float8 AS "dualEligiblePct",
              weeks_used::float8 AS "weeksUsed", weeks_in_window::float8 AS "weeksInWindow"
       FROM analysis_latest_state_measure WHERE measure_id = $1 ORDER BY state`,
      [head.measureId]
    ),
    // regr_intercept isn't snapshotted; derive it from the slope and the
    // means of the same states the correlation used (hospitals >= 3).
    pool.query<Correlation>(
      `SELECT c.factor, c.n::int AS n, c.r, c.r_ci_low AS "rCiLow", c.r_ci_high AS "rCiHigh", c.spearman,
              c.partial_r AS "partialR", c.partial_r_ci_low AS "partialCiLow",
              c.partial_r_ci_high AS "partialCiHigh", c.partial_q_value AS "partialQ", c.slope,
              (avg(a.outcome) - c.slope * avg(f.value))::float8 AS intercept
       FROM analysis_latest_correlations c
       JOIN analysis_latest_state_measure a ON a.measure_id = c.measure_id AND a.hospitals >= 3
       CROSS JOIN LATERAL (SELECT CASE c.factor
         WHEN 'inpatient_occupancy' THEN a.avg_inpatient_occupancy
         WHEN 'icu_occupancy' THEN a.avg_icu_occupancy
         WHEN 'resp_admissions_per_100_beds' THEN a.avg_resp_admissions_per_100_beds
         WHEN 'stdzd_spend_pc' THEN a.stdzd_spend_pc
         WHEN 'ip_stdzd_spend_pc' THEN a.ip_stdzd_spend_pc END AS value) f
       WHERE c.measure_id = $1 AND f.value IS NOT NULL AND a.dual_eligible_pct IS NOT NULL
       GROUP BY c.factor, c.n, c.r, c.r_ci_low, c.r_ci_high, c.spearman, c.partial_r,
                c.partial_r_ci_low, c.partial_r_ci_high, c.partial_q_value, c.slope
       ORDER BY c.factor`,
      [head.measureId]
    ),
  ])

  return { ...head, states: states.rows, correlations: correlations.rows }
}
