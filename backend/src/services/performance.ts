import { pool } from '../db/pool'

// Reads the expected-vs-actual snapshot (migrations/008, analysis/expected.ts).
// Gaps are oriented so positive always means better than expected.

export interface ContextSummary {
  category: string
  measureId: string
  unit: string
  higherIsBetter: boolean
  method: string
  hospitals: number
  r2Cv: number
  importance: Record<string, number>
  coefficients: Record<string, { estimate: number; se: number }>
  rankAgreement: number
  tau: number
  better: number
  worse: number
}

export async function getContextSummary(): Promise<ContextSummary[]> {
  const { rows } = await pool.query<ContextSummary>(`
    SELECT m.category, e.measure_id AS "measureId", m.unit, m.higher_is_better AS "higherIsBetter",
           e.method, e.hospitals, e.r2_cv AS "r2Cv", e.importance, e.coefficients,
           e.rank_agreement AS "rankAgreement", e.tau,
           count(*) FILTER (WHERE h.verdict = 'better')::int AS better,
           count(*) FILTER (WHERE h.verdict = 'worse')::int AS worse
    FROM analysis_latest_expected_models e
    JOIN measures m ON m.measure_id = e.measure_id
    LEFT JOIN analysis_latest_hospital_expected h ON h.measure_id = e.measure_id
    WHERE m.category IS NOT NULL
    GROUP BY m.category, e.measure_id, m.unit, m.higher_is_better, e.method, e.hospitals, e.r2_cv,
             e.importance, e.coefficients, e.rank_agreement, e.tau
    ORDER BY e.r2_cv DESC`)
  return rows
}

export interface LeaderboardRow {
  id: string
  name: string
  city: string | null
  state: string
  hospitalType: string | null
  measures: number
  score: number
  scoreSe: number
  verdict: 'better' | 'as_expected' | 'worse'
  nationalRank: number
  stateRank: number
}

export interface Leaderboard {
  hospitals: number
  better: number
  worse: number
  top: LeaderboardRow[]
  bottom: LeaderboardRow[]
}

const LEADERBOARD_COLUMNS = `
  h.facility_id AS id, h.name, h.city, c.state, h.hospital_type AS "hospitalType", c.measures,
  c.score, c.score_se AS "scoreSe", c.verdict, c.national_rank AS "nationalRank", c.state_rank AS "stateRank"`

// Overall context-adjusted ranking, nationally or within one state.
export async function getLeaderboard(state: string | null, limit: number): Promise<Leaderboard> {
  const n = Math.min(Math.max(limit, 1), 50)
  const where = 'WHERE ($1::text IS NULL OR c.state = $1)'
  const [counts, top, bottom] = await Promise.all([
    pool.query<{ hospitals: number; better: number; worse: number }>(
      `SELECT count(*)::int AS hospitals, count(*) FILTER (WHERE verdict = 'better')::int AS better,
              count(*) FILTER (WHERE verdict = 'worse')::int AS worse
       FROM analysis_latest_hospital_composite c ${where}`,
      [state]
    ),
    pool.query<LeaderboardRow>(
      `SELECT ${LEADERBOARD_COLUMNS} FROM analysis_latest_hospital_composite c
       JOIN hospitals h USING (facility_id) ${where} ORDER BY c.score DESC, h.name LIMIT $2`,
      [state, n]
    ),
    pool.query<LeaderboardRow>(
      `SELECT ${LEADERBOARD_COLUMNS} FROM analysis_latest_hospital_composite c
       JOIN hospitals h USING (facility_id) ${where} ORDER BY c.score ASC, h.name LIMIT $2`,
      [state, n]
    ),
  ])
  return { ...counts.rows[0], top: top.rows, bottom: bottom.rows }
}

export interface MeasurePerformanceRow {
  id: string
  name: string
  city: string | null
  state: string
  actual: number
  expected: number
  gap: number
  adjustedGap: number
  gapSe: number
  verdict: 'better' | 'as_expected' | 'worse'
}

// For one category: the hospitals furthest above and below expectations.
// Ordered by the adjusted (shrunk) gap, so noisy small hospitals don't crowd
// the lists.
export async function getMeasurePerformance(category: string, state: string | null, limit: number) {
  const { rows: [measure] } = await pool.query<{ measure_id: string; unit: string; higher_is_better: boolean }>(
    'SELECT measure_id, unit, higher_is_better FROM measures WHERE category = $1',
    [category]
  )
  if (!measure) return null
  const n = Math.min(Math.max(limit, 1), 50)
  const query = (direction: 'ASC' | 'DESC') => pool.query<MeasurePerformanceRow>(
    `SELECT h.facility_id AS id, h.name, h.city, h.state, e.actual, e.expected, e.gap,
            e.adjusted_gap AS "adjustedGap", e.gap_se AS "gapSe", e.verdict
     FROM analysis_latest_hospital_expected e JOIN hospitals h USING (facility_id)
     WHERE e.measure_id = $1 AND ($2::text IS NULL OR h.state = $2)
     ORDER BY e.adjusted_gap ${direction}, h.name LIMIT $3`,
    [measure.measure_id, state, n]
  )
  const [over, under] = await Promise.all([query('DESC'), query('ASC')])
  return {
    measureId: measure.measure_id,
    unit: measure.unit,
    higherIsBetter: measure.higher_is_better,
    over: over.rows,
    under: under.rows,
  }
}

// Per-hospital expected-vs-actual rows and composite, for the hospital page.
export async function getHospitalPerformance(id: string) {
  const [measures, overall] = await Promise.all([
    pool.query(
      `SELECT m.category, e.expected, e.adjusted_gap AS "adjustedGap", e.gap_se AS "gapSe", e.verdict
       FROM analysis_latest_hospital_expected e JOIN measures m USING (measure_id) WHERE e.facility_id = $1`,
      [id]
    ),
    pool.query(
      `SELECT c.measures, c.score, c.score_se AS "scoreSe", c.verdict, c.national_rank AS "nationalRank",
              c.state_rank AS "stateRank",
              (SELECT count(*)::int FROM analysis_latest_hospital_composite) AS "nationalCount",
              (SELECT count(*)::int FROM analysis_latest_hospital_composite x WHERE x.state = c.state) AS "stateCount"
       FROM analysis_latest_hospital_composite c WHERE c.facility_id = $1`,
      [id]
    ),
  ])
  return { measures: measures.rows, overall: overall.rows[0] ?? null }
}
