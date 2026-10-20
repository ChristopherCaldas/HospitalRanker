import type { Client } from 'pg'
import { crossValidatedR2, noiseModel, predict, shrink, spearman, weightedR2, wlsWithSe } from './stats'

// "Expected vs. actual" hospital performance.
//
// For each measure, a weighted regression predicts the score a hospital would
// be expected to get given its context: its peer group (hospital type and
// ownership) and its state's hospital crowding, Medicare spending and
// low-income share over the measure's own window. Volume is deliberately NOT a
// predictor (larger hospitals' real quality advantage should still count); it
// only sets how noisy each score is.
//
// Each measure also gets a "does context matter?" summary: cross-validated
// R^2, coefficient estimates with standard errors, the drop in
// cross-validated R^2 when each group of predictors is removed, and how much
// adjusting reorders hospitals (rank agreement between raw and adjusted).
//
// The gap (actual - expected, oriented so + is better) is judged against its
// uncertainty, handled per measure:
//   shrunk       raw measures (ER minutes, star ratings): empirical-Bayes
//                shrinkage toward the expected score; noise ~ 1/cases, plus a
//                fixed rounding-noise floor for whole-star ratings
//   cms_smoothed CMS's risk-standardized rates are already shrunk by its
//                hierarchical models, so no second shrinkage; binomial SE
//   cms_interval CMS publishes a 95% interval; SE taken from it
//
// "Clear cases only": a hospital is labeled better/worse than expected only if
// its 95% interval lies entirely beyond a meaningful margin, one standard
// deviation of the real (noise-free) hospital-to-hospital variation (tau).
// Being merely statistically different from the line isn't enough: with
// precise data almost every hospital is.

export type Method = 'shrunk' | 'cms_smoothed' | 'cms_interval'
export type Verdict = 'better' | 'as_expected' | 'worse'

const METHODS: Record<string, Method> = {
  OP_18b: 'shrunk',
  H_COMP_1_STAR_RATING: 'shrunk',
  MORT_30_AMI: 'cms_smoothed',
  READM_30_HF: 'cms_smoothed',
  PSI_90: 'cms_interval',
}

// Ratings published as whole stars carry rounding error: uniform over a
// one-star bin, variance 1/12, regardless of how many surveys there were.
const NOISE_FLOOR: Record<string, number> = { H_COMP_1_STAR_RATING: 1 / 12 }

export const Z_95 = 1.96
export const MIN_COMPOSITE_MEASURES = 3

export interface HospitalInput {
  facilityId: string
  state: string
  score: number
  cases: number | null
  lowerEstimate: number | null
  higherEstimate: number | null
  hospitalType: string | null
  ownership: string | null
  occupancy: number
  spend: number
  dual: number
}

export interface HospitalResult {
  facilityId: string
  state: string
  actual: number
  expected: number
  gap: number
  adjustedGap: number
  gapSe: number
  z: number
  verdict: Verdict
}

export interface ModelSummary {
  method: Method
  hospitals: number
  r2: number
  r2Cv: number
  coefficients: Record<string, { estimate: number; se: number }>
  importance: Record<string, number>
  rankAgreement: number
  tau: number
  margin: number
  noiseK: number | null
}

const PREDICTORS = [
  'intercept', 'critical_access', 'federal', 'other_type', 'for_profit', 'public', 'physician_owned',
  'occupancy_per_10pt', 'medicare_spend_per_1k', 'low_income_per_10pt',
]

// Column indexes of each context group, for the drop-one-group test.
const GROUPS: Record<string, number[]> = {
  peer_group: [1, 2, 3, 4, 5, 6],
  crowding: [7],
  spending: [8],
  low_income: [9],
}

// Peer group + state context. Federal ownership is covered by the federal
// type dummy, so it gets no ownership column of its own.
export function features(h: HospitalInput): number[] {
  const type = h.hospitalType ?? ''
  const own = h.ownership ?? ''
  const federal = /Veterans|Defense/.test(type)
  const isPublic = (own.startsWith('Government') && !own.includes('Federal')) || own === 'Tribal'
  return [
    1,
    +(type === 'Critical Access Hospitals'),
    +federal,
    +(!federal && type !== 'Acute Care Hospitals' && type !== 'Critical Access Hospitals'),
    +(own === 'Proprietary'),
    +isPublic,
    +(own === 'Physician'),
    h.occupancy / 10,
    h.spend / 1000,
    h.dual * 10,
  ]
}

// Clear cases only: the whole 95% interval must sit beyond the margin.
export function verdictOf(mean: number, sd: number, margin: number): Verdict {
  if (mean - Z_95 * sd > margin) return 'better'
  if (mean + Z_95 * sd < -margin) return 'worse'
  return 'as_expected'
}

export function fitMeasure(
  measureId: string,
  higherIsBetter: boolean,
  rows: HospitalInput[]
): { summary: ModelSummary; results: HospitalResult[] } {
  const method = METHODS[measureId] ?? 'shrunk'
  const floor = NOISE_FLOOR[measureId] ?? 0
  const sign = higherIsBetter ? 1 : -1
  const usable = rows.filter(r =>
    method === 'cms_interval' ? r.lowerEstimate !== null && r.higherEstimate !== null : r.cases !== null && r.cases > 0
  )
  const X = usable.map(features)
  const y = usable.map(r => r.score)

  // Per-hospital sampling variance (squared SE) of the published score.
  let noiseK: number | null = null
  let tau2Shrunk = 0
  let se2: number[]
  if (method === 'cms_interval') {
    se2 = usable.map(r => ((r.higherEstimate! - r.lowerEstimate!) / (2 * Z_95)) ** 2)
  } else if (method === 'cms_smoothed') {
    // Rates are percentages: SE of a proportion p over n cases, in points.
    se2 = usable.map(r => {
      const p = Math.min(Math.max(r.score / 100, 0.001), 0.999)
      return (100 ** 2 * p * (1 - p)) / r.cases!
    })
  } else {
    // Unweighted first pass -> residuals -> split their variance into real
    // between-hospital variation (tau^2) and volume-dependent noise (k/n).
    // A constant noise floor is indistinguishable from tau^2 in that split,
    // so it's subtracted back out.
    const first = wlsWithSe(X, y, y.map(() => 1)).beta
    const fit = noiseModel(y.map((v, i) => v - predict(X[i], first)), usable.map(r => r.cases!))
    noiseK = fit.k
    tau2Shrunk = Math.max(0, fit.tau2 - floor)
    se2 = usable.map(r => fit.k / r.cases! + floor)
  }

  // Inverse-variance weights (tau^2 included where it's known).
  const w = se2.map(s => 1 / (tau2Shrunk + s + 1e-9))
  const { beta, se } = wlsWithSe(X, y, w)
  const expected = X.map(x => predict(x, beta))
  const gaps = usable.map((r, i) => sign * (r.score - expected[i]))

  // tau: spread of real performance differences. CMS's published rates
  // (mortality, readmission, PSI 90) are already shrunk toward the mean by its
  // own models, so their gaps' spread is itself the signal spread;
  // subtracting sampling noise again would double-count it (and goes to 0).
  let tau2 = tau2Shrunk
  if (method !== 'shrunk') {
    const mean = gaps.reduce((a, g) => a + g, 0) / gaps.length
    tau2 = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / (gaps.length - 1)
  }
  const margin = Math.sqrt(tau2)

  const results = usable.map((r, i): HospitalResult => {
    // shrunk: shrink here. cms_smoothed: the published rate already is a
    // shrunk (posterior-mean) estimate, so keep it, but its uncertainty is the
    // posterior SD, not the raw binomial SE, which would overstate it.
    // cms_interval: CMS's own interval is used as published.
    const post =
      method === 'shrunk'
        ? shrink(gaps[i], se2[i], tau2)
        : method === 'cms_smoothed'
          ? { mean: gaps[i], sd: Math.sqrt((tau2 * se2[i]) / (tau2 + se2[i])) }
          : { mean: gaps[i], sd: Math.sqrt(se2[i]) }
    return {
      facilityId: r.facilityId,
      state: r.state,
      actual: r.score,
      expected: expected[i],
      gap: gaps[i],
      adjustedGap: post.mean,
      gapSe: post.sd,
      z: post.sd > 0 ? post.mean / post.sd : 0,
      verdict: verdictOf(post.mean, post.sd, margin),
    }
  })

  // Does context matter? Cross-validated R^2, with and without each group.
  const r2Cv = crossValidatedR2(X, y, w)
  const importance = Object.fromEntries(
    Object.entries(GROUPS).map(([group, cols]) => {
      const reduced = X.map(x => x.filter((_, j) => !cols.includes(j)))
      return [group, r2Cv - crossValidatedR2(reduced, y, w)]
    })
  )

  return {
    summary: {
      method,
      hospitals: usable.length,
      r2: weightedR2(y, expected, w),
      r2Cv,
      coefficients: Object.fromEntries(PREDICTORS.map((name, j) => [name, { estimate: beta[j], se: se[j] }])),
      importance,
      // How much adjusting reorders hospitals: raw (oriented) vs adjusted.
      rankAgreement: spearman(usable.map(r => sign * r.score), results.map(r => r.adjustedGap)),
      tau: margin,
      margin,
      noiseK,
    },
    results,
  }
}

export interface CompositeResult {
  facilityId: string
  state: string
  measures: number
  score: number
  scoreSe: number
  verdict: Verdict
  nationalRank: number
  stateRank: number
}

// Puts each measure's gaps in units of that measure's tau (the real spread of
// performance), then averages them per hospital; measures are treated as
// independent when combining uncertainty. The composite is then shrunk by its
// own uncertainty, and the clear-cases margin is one SD of the real spread of
// composites (the same rule as each measure, on the composite scale).
export function composite(byMeasure: { tau: number; results: HospitalResult[] }[]): CompositeResult[] {
  const scaled = new Map<string, { state: string; values: number[]; ses: number[] }>()
  for (const { tau, results } of byMeasure) {
    if (!(tau > 0)) continue
    for (const r of results) {
      const entry = scaled.get(r.facilityId) ?? { state: r.state, values: [], ses: [] }
      entry.values.push(r.adjustedGap / tau)
      entry.ses.push(r.gapSe / tau)
      scaled.set(r.facilityId, entry)
    }
  }

  const rows = [...scaled.entries()]
    .filter(([, e]) => e.values.length >= MIN_COMPOSITE_MEASURES)
    .map(([facilityId, e]) => {
      const k = e.values.length
      const score = e.values.reduce((a, b) => a + b, 0) / k
      const scoreSe = Math.sqrt(e.ses.reduce((a, s) => a + s * s, 0)) / k
      return { facilityId, state: e.state, measures: k, raw: score, rawSe: scoreSe }
    })

  // Shrink composites by their own uncertainty too, so a hospital with three
  // noisy measures can't top the list on luck: tau_c^2 is the composite
  // spread minus average noise; each score is pulled toward 0 accordingly.
  const mean = rows.reduce((a, r) => a + r.raw, 0) / Math.max(1, rows.length)
  const variance = rows.reduce((a, r) => a + (r.raw - mean) ** 2, 0) / Math.max(1, rows.length - 1)
  const tau2 = Math.max(1e-6, variance - rows.reduce((a, r) => a + r.rawSe ** 2, 0) / Math.max(1, rows.length))
  const margin = Math.sqrt(tau2)
  const ranked = rows
    .map(r => {
      const post = shrink(r.raw, r.rawSe ** 2, tau2)
      return { facilityId: r.facilityId, state: r.state, measures: r.measures, score: post.mean, scoreSe: post.sd }
    })
    .sort((a, b) => b.score - a.score || a.facilityId.localeCompare(b.facilityId))

  const stateCounts = new Map<string, number>()
  return ranked.map((r, i) => {
    const stateRank = (stateCounts.get(r.state) ?? 0) + 1
    stateCounts.set(r.state, stateRank)
    return { ...r, verdict: verdictOf(r.score, r.scoreSe, margin), nationalRank: i + 1, stateRank }
  })
}

// Reads inputs for every category measure, fits, and writes the results under
// `runId`. Runs inside the analyze job's transaction.
export async function writeExpectedPerformance(db: Client, runId: number): Promise<void> {
  const { rows } = await db.query(`
    SELECT s.measure_id, m.higher_is_better, s.facility_id, h.state, s.score::float8 AS score, s.denominator AS cases,
           s.lower_estimate::float8 AS lower_estimate, s.higher_estimate::float8 AS higher_estimate,
           h.hospital_type, h.ownership,
           a.avg_inpatient_occupancy::float8 AS occupancy, a.stdzd_spend_pc::float8 AS spend,
           a.dual_eligible_pct::float8 AS dual
    FROM analysis_measure_windows w
    JOIN measures m ON m.measure_id = w.measure_id
    JOIN measure_scores s ON s.measure_id = w.measure_id AND s.release_id = w.release_id AND s.score IS NOT NULL
    JOIN hospitals h ON h.facility_id = s.facility_id
    JOIN analysis_state_measure_live a ON a.measure_id = s.measure_id AND a.state = h.state
    WHERE a.avg_inpatient_occupancy IS NOT NULL AND a.stdzd_spend_pc IS NOT NULL AND a.dual_eligible_pct IS NOT NULL`)

  const fitted: { tau: number; results: HospitalResult[] }[] = []
  for (const measureId of [...new Set(rows.map(r => r.measure_id as string))].sort()) {
    const measureRows = rows.filter(r => r.measure_id === measureId)
    const { summary, results } = fitMeasure(
      measureId,
      measureRows[0].higher_is_better,
      measureRows.map(r => ({
        facilityId: r.facility_id, state: r.state, score: r.score, cases: r.cases,
        lowerEstimate: r.lower_estimate, higherEstimate: r.higher_estimate,
        hospitalType: r.hospital_type, ownership: r.ownership,
        occupancy: r.occupancy, spend: r.spend, dual: r.dual,
      }))
    )
    fitted.push({ tau: summary.tau, results })

    await db.query(
      `INSERT INTO analysis_expected_models
         (run_id, measure_id, method, hospitals, r2, r2_cv, coefficients, importance, rank_agreement, tau, noise_k)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [runId, measureId, summary.method, summary.hospitals, summary.r2, summary.r2Cv, JSON.stringify(summary.coefficients),
        JSON.stringify(summary.importance), summary.rankAgreement, summary.tau, summary.noiseK]
    )
    const col = <K extends keyof HospitalResult>(k: K) => results.map(r => r[k])
    await db.query(
      `INSERT INTO analysis_hospital_expected (run_id, measure_id, facility_id, actual, expected, gap, adjusted_gap, gap_se, z, verdict)
       SELECT $1, $2, * FROM unnest($3::text[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::float8[], $9::float8[], $10::text[])`,
      [runId, measureId, col('facilityId'), col('actual'), col('expected'), col('gap'), col('adjustedGap'),
        col('gapSe'), col('z'), col('verdict')]
    )
    const count = (v: Verdict) => results.filter(r => r.verdict === v).length
    const imp = Object.entries(summary.importance).map(([g, d]) => `${g} ${(d * 100).toFixed(1)}`).join(', ')
    console.log(`  ${measureId} (${summary.method}): ${summary.hospitals} hospitals, R2 cv ${summary.r2Cv.toFixed(3)}, ` +
      `rank agreement ${summary.rankAgreement.toFixed(2)}; better ${count('better')}, worse ${count('worse')}; R2 points lost without: ${imp}`)
  }

  const overall = composite(fitted)
  const col = <K extends keyof CompositeResult>(k: K) => overall.map(r => r[k])
  await db.query(
    `INSERT INTO analysis_hospital_composite (run_id, facility_id, state, measures, score, score_se, verdict, national_rank, state_rank)
     SELECT $1, * FROM unnest($2::text[], $3::text[], $4::int[], $5::float8[], $6::float8[], $7::text[], $8::int[], $9::int[])`,
    [runId, col('facilityId'), col('state'), col('measures'), col('score'), col('scoreSe'), col('verdict'),
      col('nationalRank'), col('stateRank')]
  )
  const better = overall.filter(r => r.verdict === 'better').length
  const worse = overall.filter(r => r.verdict === 'worse').length
  console.log(`  composite: ${overall.length} hospitals with ${MIN_COMPOSITE_MEASURES}+ measures; better ${better}, worse ${worse}`)
}
