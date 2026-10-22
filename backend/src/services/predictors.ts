import { pool } from '../db/pool'

// "What predicts hospital results?" (analysis/predictors.ts), latest run.

export interface PersistencePoint {
  periodStart: string | null
  periodEnd: string
  yearsBack: number
  overlapping: boolean
  r: number
  n: number
}

export interface MeasurePredictors {
  measureId: string
  category: string
  higherIsBetter: boolean
  hospitals: number
  groups: Record<string, { alone: number; added: number }>
  variables: Record<string, { r: number; n: number; coverage: number }>
  models: Record<string, number>
  noiseShare: number | null
  persistence: PersistencePoint[]
}

export interface PredictorsOverview {
  runId: number | null
  computedAt: string | null
  measures: MeasurePredictors[]
  correlations: { a: string; b: string; r: number; n: number }[]
}

export async function getPredictors(): Promise<PredictorsOverview> {
  const [run, measures, persistence, correlations] = await Promise.all([
    pool.query(`SELECT r.id, r.created_at FROM analysis_runs r
                WHERE r.id = (SELECT max(run_id) FROM analysis_predictors)`),
    pool.query(`SELECT p.measure_id, m.category, m.higher_is_better, p.hospitals, p.groups, p.variables, p.models, p.noise_share
                FROM analysis_latest_predictors p JOIN measures m USING (measure_id)
                WHERE m.category IS NOT NULL ORDER BY p.measure_id`),
    pool.query(`SELECT measure_id, period_start::text, period_end::text, years_back, overlapping, r, n
                FROM analysis_latest_persistence ORDER BY measure_id, period_end`),
    pool.query('SELECT measure_a, measure_b, r, n FROM analysis_latest_measure_correlations ORDER BY measure_a, measure_b'),
  ])
  return {
    runId: run.rows[0]?.id ?? null,
    computedAt: run.rows[0]?.created_at?.toISOString?.() ?? null,
    measures: measures.rows.map(m => ({
      measureId: m.measure_id,
      category: m.category,
      higherIsBetter: m.higher_is_better,
      hospitals: m.hospitals,
      groups: m.groups,
      variables: m.variables,
      models: m.models,
      noiseShare: m.noise_share,
      persistence: persistence.rows
        .filter(p => p.measure_id === m.measure_id)
        .map(p => ({
          periodStart: p.period_start, periodEnd: p.period_end, yearsBack: p.years_back,
          overlapping: p.overlapping, r: p.r, n: p.n,
        })),
    })),
    correlations: correlations.rows.map(c => ({ a: c.measure_a, b: c.measure_b, r: c.r, n: c.n })),
  }
}
