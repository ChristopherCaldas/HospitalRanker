import type { Client } from 'pg'
import { crossValidatedR2, noiseModel, predict, shrink, spearman, weightedR2, wlsWithSe } from './stats'
import { allScopes, type Domain, type QualityGroup, type ScoredMeasure } from './scores'

// "Expected vs. actual" hospital performance.
//
// For each measure, a weighted regression predicts the score a hospital would
// be expected to get given its context, meaning things outside management's
// day-to-day control:
//   peer group   hospital type and ownership
//   patients     the hospital's own dual-eligible and low-income (DSH) shares
//   complexity   case mix index and teaching intensity (residents per bed)
//   community    its county's social vulnerability, poverty, uninsured rate;
//                rural or not
//   state        crowding, Medicare spending and low-income share over the
//                measure's own window
// Finances and staffing are deliberately NOT predictors: adjusting for them
// would grade an understaffed or badly run hospital on a curve. They are shown
// as diagnostics instead (hospital_finance). Volume isn't a predictor either
// (larger hospitals' real quality advantage should still count); it only sets
// how noisy each score is.
//
// Each measure also gets a "does context matter?" summary: cross-validated
// R^2, coefficient estimates with standard errors, the drop in
// cross-validated R^2 when each group of predictors is removed, and how much
// adjusting reorders hospitals (rank agreement between raw and adjusted).
//
// The gap (actual - expected, oriented so + is better) is judged against its
// uncertainty, handled per measure:
//   shrunk       raw measures (ER minutes, process percentages, infection
//                ratios, star ratings): empirical-Bayes shrinkage toward the
//                expected score; noise ~ 1/cases (predicted infections for
//                SIRs), plus a fixed rounding-noise floor for whole-star ratings
//   cms_smoothed CMS's published scores are already shrunk by its own models
//                (hierarchical models for mortality, readmission and hip/knee
//                complications, reliability weighting for PSI 90), so no
//                second shrinkage; their
//                uncertainty is a posterior SD built from the sampling SE
//                (binomial from case counts, or CMS's interval for PSI 90)
//
// "Clear cases only": a hospital is labeled better/worse than expected only if
// its 95% interval lies entirely beyond a meaningful margin, one standard
// deviation of the real (noise-free) hospital-to-hospital variation (tau).
// Being merely statistically different from the line isn't enough: with
// precise data almost every hospital is.

export type Method = 'shrunk' | 'cms_smoothed'
export type Verdict = 'better' | 'as_expected' | 'worse'

// CMS's model-based rates; everything else is published raw.
const CMS_SMOOTHED = /^(MORT_30_|READM_30_|COMP_HIP_KNEE$|PSI_90$)/
export const methodOf = (measureId: string): Method => (CMS_SMOOTHED.test(measureId) ? 'cms_smoothed' : 'shrunk')

// Measures with no case counts: sampling SE comes from CMS's 95% interval.
// (PSI 90's interval is wider than the observed spread between hospitals,
// a sign the published values are already smoothed.)
const SE_FROM_INTERVAL = new Set(['PSI_90'])

// A hospital's contribution from any one measure to a group, domain or
// overall score is capped at this many SDs, so one extreme measure (PSI 90 has
// a long bad tail) can't decide it on its own.
export const COMPOSITE_CAP = 3

// Ratings published as whole stars carry rounding error: uniform over a
// one-star bin, variance 1/12, regardless of how many surveys there were.
const noiseFloor = (measureId: string) => (/_STAR_RATING$/.test(measureId) ? 1 / 12 : 0)

export const Z_95 = 1.96

export interface HospitalInput {
  facilityId: string
  state: string
  score: number
  cases: number | null
  lowerEstimate: number | null
  higherEstimate: number | null
  hospitalType: string | null
  ownership: string | null
  // state, over the measure's window
  occupancy: number
  spend: number
  stateLowIncome: number
  context?: HospitalContext | null
}

// Hospital-level context (hospital_context). Any field may be missing:
// critical access hospitals, Maryland and non-acute hospitals aren't in the
// CMS payment files that supply the patient and complexity fields.
export interface HospitalContext {
  dual: number | null // share of Medicare stays dual-eligible, 0-1
  dsh: number | null // low-income patient percentage, 0-1
  caseMix: number | null
  teaching: number | null // residents per bed
  svi: number | null // county social vulnerability percentile, 0-1
  poverty: number | null // county % below 150% of poverty
  uninsured: number | null // county % uninsured
  rural: boolean | null
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

// Hospital-level context predictors, in readable units: `per` is how much of
// the raw value one unit of the coefficient means (e.g. 0.1 = per 10 points of
// a 0-1 share).
const CONTEXT_VARS: { key: keyof HospitalContext; name: string; per: number }[] = [
  { key: 'dual', name: 'dual_eligible_per_10pt', per: 0.1 },
  { key: 'dsh', name: 'low_income_patients_per_10pt', per: 0.1 },
  { key: 'caseMix', name: 'case_mix_per_0_25', per: 0.25 },
  { key: 'teaching', name: 'residents_per_bed_per_0_1', per: 0.1 },
  { key: 'svi', name: 'county_vulnerability_per_10pt', per: 0.1 },
  { key: 'poverty', name: 'county_poverty_per_10pt', per: 10 },
  { key: 'uninsured', name: 'county_uninsured_per_5pt', per: 5 },
  { key: 'rural', name: 'rural', per: 1 },
]

const PREDICTORS = [
  'intercept', 'critical_access', 'federal', 'other_type', 'for_profit', 'public', 'physician_owned',
  'occupancy_per_10pt', 'medicare_spend_per_1k', 'low_income_per_10pt',
  ...CONTEXT_VARS.map(v => v.name),
  'no_hospital_data', 'no_county_data',
]
const col = (name: string) => PREDICTORS.indexOf(name)

// Column indexes of each context group, for the drop-one-group test.
const GROUPS: Record<string, number[]> = {
  peer_group: [1, 2, 3, 4, 5, 6],
  patients: ['dual_eligible_per_10pt', 'low_income_patients_per_10pt', 'no_hospital_data'].map(col),
  complexity: ['case_mix_per_0_25', 'residents_per_bed_per_0_1'].map(col),
  community: ['county_vulnerability_per_10pt', 'county_poverty_per_10pt', 'county_uninsured_per_5pt', 'rural', 'no_county_data'].map(col),
  crowding: [7],
  spending: [8],
  low_income: [9],
}

// Which groups each measure uses. Case mix and teaching intensity stand in
// for how sick and complex patients are, which matters for the measures that
// aren't risk-adjusted (ER time, process percentages, patient surveys). CMS's
// mortality, readmission, complication and PSI 90 scores are already adjusted
// for patient risk, and infection ratios' predicted counts already account for
// teaching status and size, so there those two would mostly measure what big
// academic centers are good at, and adjusting it away would erase the credit
// they earn (the same reasoning that keeps volume out).
const UNADJUSTED_ONLY = new Set(['complexity'])
const RISK_ADJUSTED = /^(MORT_30_|READM_30_|COMP_HIP_KNEE$|PSI_90$|HAI_)/

export function activeColumns(measureId: string): number[] {
  const dropped = new Set(
    RISK_ADJUSTED.test(measureId)
      ? Object.entries(GROUPS).filter(([g]) => UNADJUSTED_ONLY.has(g)).flatMap(([, cols]) => cols)
      : []
  )
  return PREDICTORS.map((_, j) => j).filter(j => !dropped.has(j))
}

// Per variable: clip limits (1st/99th percentile) and the mean of the clipped
// values. Missing values are set to the mean, i.e. contribute 0, and flagged.
export type ContextScales = Record<string, { lo: number; hi: number; mean: number }>

const raw = (c: HospitalContext | null | undefined, key: keyof HospitalContext): number | null => {
  const v = c?.[key]
  return v === null || v === undefined ? null : Number(v)
}

export function contextScales(rows: HospitalInput[]): ContextScales {
  const out: ContextScales = {}
  for (const { key } of CONTEXT_VARS) {
    const vals = rows.map(r => raw(r.context, key)).filter((v): v is number => v !== null).sort((a, b) => a - b)
    if (vals.length === 0) {
      out[key] = { lo: 0, hi: 0, mean: 0 }
      continue
    }
    const lo = vals[Math.floor((vals.length - 1) * 0.01)]
    const hi = vals[Math.ceil((vals.length - 1) * 0.99)]
    out[key] = { lo, hi, mean: vals.reduce((a, v) => a + Math.min(hi, Math.max(lo, v)), 0) / vals.length }
  }
  return out
}

// Peer group, state context and hospital-level context. Federal ownership is
// covered by the federal type dummy, so it gets no ownership column of its own.
export function features(h: HospitalInput, scales: ContextScales = {}): number[] {
  const type = h.hospitalType ?? ''
  const own = h.ownership ?? ''
  const federal = /Veterans|Defense/.test(type)
  const isPublic = (own.startsWith('Government') && !own.includes('Federal')) || own === 'Tribal'
  const context = CONTEXT_VARS.map(({ key, per }) => {
    const v = raw(h.context, key)
    const s = scales[key]
    if (v === null || !s) return 0
    return (Math.min(s.hi, Math.max(s.lo, v)) - s.mean) / per
  })
  const c = h.context
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
    h.stateLowIncome * 10,
    ...context,
    +(raw(c, 'dual') === null && raw(c, 'dsh') === null && raw(c, 'caseMix') === null),
    +(raw(c, 'svi') === null),
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
  const method = methodOf(measureId)
  const floor = noiseFloor(measureId)
  const sign = higherIsBetter ? 1 : -1
  const fromInterval = SE_FROM_INTERVAL.has(measureId)
  const usable = rows.filter(r =>
    fromInterval ? r.lowerEstimate !== null && r.higherEstimate !== null : r.cases !== null && r.cases > 0
  )
  const scales = contextScales(usable)
  const active = activeColumns(measureId)
  const X = usable.map(r => {
    const x = features(r, scales)
    return active.map(j => x[j])
  })
  const y = usable.map(r => r.score)

  // Per-hospital sampling variance (squared SE) of the published score.
  let noiseK: number | null = null
  let tau2Shrunk = 0
  let se2: number[]
  if (fromInterval) {
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
    // shrunk: shrink here. cms_smoothed: the published score already is a
    // shrunk (posterior-mean) estimate, so keep it, but its uncertainty is the
    // posterior SD, not the raw sampling SE, which would overstate it.
    const post =
      method === 'shrunk'
        ? shrink(gaps[i], se2[i], tau2)
        : { mean: gaps[i], sd: Math.sqrt((tau2 * se2[i]) / (tau2 + se2[i])) }
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
    Object.entries(GROUPS).filter(([, cols]) => cols.some(c => active.includes(c))).map(([group, cols]) => {
      const reduced = X.map(x => x.filter((_, j) => !cols.includes(active[j])))
      return [group, r2Cv - crossValidatedR2(reduced, y, w)]
    })
  )

  return {
    summary: {
      method,
      hospitals: usable.length,
      r2: weightedR2(y, expected, w),
      r2Cv,
      coefficients: Object.fromEntries(active.map((p, j) => [PREDICTORS[p], { estimate: beta[j], se: se[j] }])),
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

// Reads inputs for every quality measure, fits, writes the results and the
// group/domain/overall scores under `runId`. Runs inside the analyze job's
// transaction.
export async function writeExpectedPerformance(db: Client, runId: number): Promise<void> {
  const { rows } = await db.query(`
    SELECT s.measure_id, m.higher_is_better, m.quality_group, m.domain, s.facility_id, h.state, s.score::float8 AS score, s.denominator AS cases,
           s.lower_estimate::float8 AS lower_estimate, s.higher_estimate::float8 AS higher_estimate,
           h.hospital_type, h.ownership,
           a.avg_inpatient_occupancy::float8 AS occupancy, a.stdzd_spend_pc::float8 AS spend,
           a.dual_eligible_pct::float8 AS state_low_income,
           c.dual_proportion AS ctx_dual, c.dsh_pct AS ctx_dsh, c.case_mix_index AS ctx_case_mix,
           c.resident_bed_ratio AS ctx_teaching, c.svi_percentile AS ctx_svi, c.poverty150_pct AS ctx_poverty,
           c.uninsured_pct AS ctx_uninsured, c.rural AS ctx_rural
    FROM analysis_measure_windows w
    JOIN measures m ON m.measure_id = w.measure_id
    JOIN measure_scores s ON s.measure_id = w.measure_id AND s.release_id = w.release_id AND s.score IS NOT NULL
    JOIN hospitals h ON h.facility_id = s.facility_id
    JOIN analysis_state_measure_live a ON a.measure_id = s.measure_id AND a.state = h.state
    LEFT JOIN hospital_context c ON c.facility_id = s.facility_id
    WHERE m.quality_group IS NOT NULL
      AND a.avg_inpatient_occupancy IS NOT NULL AND a.stdzd_spend_pc IS NOT NULL AND a.dual_eligible_pct IS NOT NULL`)

  const fitted: ScoredMeasure[] = []
  for (const measureId of [...new Set(rows.map(r => r.measure_id as string))].sort()) {
    const measureRows = rows.filter(r => r.measure_id === measureId)
    const { summary, results } = fitMeasure(
      measureId,
      measureRows[0].higher_is_better,
      measureRows.map(r => ({
        facilityId: r.facility_id, state: r.state, score: r.score, cases: r.cases,
        lowerEstimate: r.lower_estimate, higherEstimate: r.higher_estimate,
        hospitalType: r.hospital_type, ownership: r.ownership,
        occupancy: r.occupancy, spend: r.spend, stateLowIncome: r.state_low_income,
        context: {
          dual: r.ctx_dual, dsh: r.ctx_dsh, caseMix: r.ctx_case_mix, teaching: r.ctx_teaching,
          svi: r.ctx_svi, poverty: r.ctx_poverty, uninsured: r.ctx_uninsured, rural: r.ctx_rural,
        },
      }))
    )
    fitted.push({
      measureId, group: measureRows[0].quality_group as QualityGroup, domain: measureRows[0].domain as Domain,
      tau: summary.tau, results,
    })

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

  const scopes = allScopes(fitted)
  for (const [scope, scored] of Object.entries(scopes)) {
    const col = <K extends keyof (typeof scored)[number]>(k: K) => scored.map(r => r[k])
    await db.query(
      `INSERT INTO analysis_hospital_scores (run_id, scope, facility_id, state, measures, groups, score, score_se,
                                             verdict, national_rank, state_rank)
       SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::int[], $6::int[], $7::float8[], $8::float8[],
                                    $9::text[], $10::int[], $11::int[])`,
      [runId, scope, col('facilityId'), col('state'), col('measures'), col('groups'), col('score'), col('scoreSe'),
        col('verdict'), col('nationalRank'), col('stateRank')]
    )
    const count = (v: Verdict) => scored.filter(r => r.verdict === v).length
    console.log(`  ${scope}: ${scored.length} hospitals; better ${count('better')}, worse ${count('worse')}`)
  }

  // The overall score also backs the existing composite table.
  const overall = scopes.overall
  const col = <K extends keyof (typeof overall)[number]>(k: K) => overall.map(r => r[k])
  await db.query(
    `INSERT INTO analysis_hospital_composite (run_id, facility_id, state, measures, score, score_se, verdict, national_rank, state_rank)
     SELECT $1, * FROM unnest($2::text[], $3::text[], $4::int[], $5::float8[], $6::float8[], $7::text[], $8::int[], $9::int[])`,
    [runId, col('facilityId'), col('state'), col('measures'), col('score'), col('scoreSe'), col('verdict'),
      col('nationalRank'), col('stateRank')]
  )
}
