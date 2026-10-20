import { pool } from '../db/pool'
import { HOSPITAL_NOTES, NOTES_CHECKED, US_NEWS_HONOR_ROLL } from '../content/hospitalNotes'
import { getHistories } from './history'

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
  overallRating: number | null
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
  c.score, c.score_se AS "scoreSe", c.verdict, c.national_rank AS "nationalRank", c.state_rank AS "stateRank",
  h.overall_rating AS "overallRating"`

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

// The national top and bottom few, each with what drives its score (every
// measure's actual vs. expected), its yearly history and curated notes.
export async function getSpotlight(n = 5) {
  const board = await getLeaderboard(null, n)
  const rows = [...board.top, ...board.bottom]
  const ids = rows.map(r => r.id)
  const [{ rows: measures }, histories] = await Promise.all([
    pool.query<{
      id: string; category: string; unit: string; higherIsBetter: boolean
      actual: number; expected: number; gapSd: number; verdict: string
    }>(
      `SELECT e.facility_id AS id, m.category, m.unit, m.higher_is_better AS "higherIsBetter",
              e.actual, e.expected, e.adjusted_gap / x.tau AS "gapSd", e.verdict
       FROM analysis_latest_hospital_expected e
       JOIN measures m USING (measure_id)
       JOIN analysis_latest_expected_models x USING (measure_id)
       WHERE e.facility_id = ANY($1) AND m.category IS NOT NULL`,
      [ids]
    ),
    getHistories(ids),
  ])
  const honorRoll = new Set(US_NEWS_HONOR_ROLL.facilityIds)
  const detail = (r: LeaderboardRow) => ({
    ...r,
    usNewsHonorRoll: honorRoll.has(r.id),
    breakdown: measures.filter(m => m.id === r.id).map(({ id: _id, ...m }) => m),
    history: histories[r.id],
    notes: HOSPITAL_NOTES[r.id] ?? [],
  })
  return {
    hospitals: board.hospitals,
    notesChecked: NOTES_CHECKED,
    top: board.top.map(detail),
    bottom: board.bottom.map(detail),
  }
}

// Sanity check: how the overall context-adjusted ranking lines up with CMS's
// own star rating and with the U.S. News Honor Roll.
export async function getBenchmarks() {
  const [byStars, agreement, honor, ranked] = await Promise.all([
    pool.query(
      `SELECT h.overall_rating AS stars, count(*)::int AS hospitals, avg(c.score) AS "avgScore",
              percentile_cont(0.5) WITHIN GROUP (ORDER BY c.national_rank) AS "medianRank",
              count(*) FILTER (WHERE c.verdict = 'better')::int AS better,
              count(*) FILTER (WHERE c.verdict = 'worse')::int AS worse
       FROM analysis_latest_hospital_composite c JOIN hospitals h USING (facility_id)
       GROUP BY h.overall_rating ORDER BY h.overall_rating NULLS LAST`
    ),
    // Spearman: Pearson correlation of average ranks (ties share a rank).
    pool.query<{ spearman: number; hospitals: number }>(
      `WITH r AS (
         SELECT rank() OVER (ORDER BY c.score) + (count(*) OVER (PARTITION BY c.score) - 1) / 2.0 AS a,
                rank() OVER (ORDER BY h.overall_rating) + (count(*) OVER (PARTITION BY h.overall_rating) - 1) / 2.0 AS b
         FROM analysis_latest_hospital_composite c JOIN hospitals h USING (facility_id)
         WHERE h.overall_rating IS NOT NULL
       )
       SELECT corr(a, b) AS spearman, count(*)::int AS hospitals FROM r`
    ),
    pool.query(
      // Each hospital's weakest measure explains most disagreements.
      `SELECT h.facility_id AS id, h.name, h.city, h.state, c.national_rank AS "nationalRank", c.score, c.verdict,
              w.weakest
       FROM hospitals h
       LEFT JOIN analysis_latest_hospital_composite c USING (facility_id)
       LEFT JOIN LATERAL (
         SELECT json_build_object('category', m.category, 'unit', m.unit, 'actual', e.actual,
                                  'expected', e.expected, 'gapSd', e.adjusted_gap / x.tau) AS weakest
         FROM analysis_latest_hospital_expected e
         JOIN measures m USING (measure_id)
         JOIN analysis_latest_expected_models x USING (measure_id)
         WHERE e.facility_id = h.facility_id AND m.category IS NOT NULL
         ORDER BY e.adjusted_gap / x.tau LIMIT 1
       ) w ON true
       WHERE h.facility_id = ANY($1)
       ORDER BY c.national_rank NULLS LAST`,
      [US_NEWS_HONOR_ROLL.facilityIds]
    ),
    pool.query<{ n: number }>('SELECT count(*)::int AS n FROM analysis_latest_hospital_composite'),
  ])
  return {
    ranked: ranked.rows[0].n,
    stars: { byRating: byStars.rows, ...agreement.rows[0] },
    usNewsHonorRoll: {
      edition: US_NEWS_HONOR_ROLL.edition,
      published: US_NEWS_HONOR_ROLL.published,
      url: US_NEWS_HONOR_ROLL.url,
      hospitals: honor.rows,
    },
  }
}
