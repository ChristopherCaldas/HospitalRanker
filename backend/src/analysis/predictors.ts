import type { Client } from 'pg'
import { crossValidatedR2, noiseModel, pearson } from './stats'

// "What predicts hospital results?"
//
// The expected-score model (expected.ts) only uses context that's fair to
// grade on a curve. This asks a different question: which facts about a
// hospital go with better *actual* scores at all? So anything is fair game:
// state conditions, money, size, staffing, system membership and the
// hospital's own past scores. Associations, not causes.
//
// Per measure, for each group of predictors:
//   alone  5-fold cross-validated R^2 of the group by itself
//   added  cross-validated R^2 lost when the group is dropped from everything
//          we know about hospitals (for the track record: what it adds on top)
// plus four combined models (what we first assumed, the fair context the
// expected scores use, everything known, and everything + track record) and
// each variable's simple correlation with the score.
//
// Two companion results: how well a score from N years earlier predicts the
// current one (persistence), and how strongly hospitals' scores on different
// measures go together (is quality one thing?).

type Method = 'shrunk' | 'binomial' | 'interval'

// How each measure's sampling noise is estimated, for inverse-variance
// weights (the same choices as the expected-score model).
const METHODS: Record<string, Method> = {
  OP_18b: 'shrunk',
  H_COMP_1_STAR_RATING: 'shrunk',
  MORT_30_AMI: 'binomial',
  READM_30_HF: 'binomial',
  PSI_90: 'interval',
}
const NOISE_FLOOR: Record<string, number> = { H_COMP_1_STAR_RATING: 1 / 12 }

export interface PredictorRow {
  facilityId: string
  score: number
  cases: number | null
  lowerEstimate: number | null
  higherEstimate: number | null
  hospitalType: string | null
  ownership: string | null
  prior: number | null // most recent earlier score whose period doesn't overlap the current one
  values: Record<string, number | null> // VARIABLES keys, raw units
}

// log(1 + x) for skewed counts and dollar amounts; negatives are bad data.
const log1p = (v: number | null) => (v === null || v < 0 ? null : Math.log1p(v))

// Raw value per variable from the analysis query's columns.
export const VARIABLES: Record<string, (r: Record<string, number | null>) => number | null> = {
  state_crowding: r => r.st_occupancy,
  state_respiratory: r => r.st_respiratory,
  state_spending: r => r.st_spend,
  state_low_income: r => r.st_low_income,
  patient_margin: r => r.patient_margin,
  total_margin: r => r.total_margin,
  dual: r => r.dual,
  dsh: r => r.dsh,
  medicaid_days: r => r.medicaid_days,
  svi: r => r.svi,
  poverty: r => r.poverty,
  uninsured: r => r.uninsured,
  rural: r => r.rural,
  case_mix: r => r.case_mix,
  teaching: r => r.teaching,
  beds: r => log1p(r.beds),
  discharges: r => log1p(r.discharges),
  cases: r => log1p(r.cases),
  in_system: r => (r.system_hospitals === null ? null : +(r.system_hospitals > 1)),
  system_size: r => log1p(r.system_hospitals),
  other_income: r => r.other_income,
  uncompensated: r => r.uncompensated,
  cost_per_discharge: r => log1p(r.cost_per_discharge),
  salary_per_fte: r => r.salary_per_fte,
  investments_per_bed: r => log1p(r.investments_per_bed),
  fixed_assets_per_bed: r => log1p(r.fixed_assets_per_bed),
  debt_ratio: r => r.debt_ratio,
  current_ratio: r => r.current_ratio,
  fte_per_bed: r => r.fte_per_bed,
  contract_labor: r => r.contract_labor,
  occupancy: r => r.occupancy,
}

// Peer group is hospital type/ownership dummies; track record is the prior score.
export const GROUPS: Record<string, string[]> = {
  state: ['state_crowding', 'state_respiratory', 'state_spending', 'state_low_income'],
  profit: ['patient_margin', 'total_margin'],
  peer_group: [],
  patients: ['dual', 'dsh', 'medicaid_days'],
  community: ['svi', 'poverty', 'uninsured', 'rural'],
  complexity: ['case_mix', 'teaching'],
  size: ['beds', 'discharges', 'cases'],
  system: ['in_system', 'system_size'],
  finances: ['other_income', 'uncompensated', 'cost_per_discharge', 'salary_per_fte', 'investments_per_bed',
    'fixed_assets_per_bed', 'debt_ratio', 'current_ratio'],
  staffing: ['fte_per_bed', 'contract_labor', 'occupancy'],
  track_record: [],
}

const MODELS: Record<string, string[]> = {
  // What the state comparisons and the Finances page started from.
  assumptions: ['state', 'profit'],
  // The inputs of the expected-score model (complexity for every measure here).
  fair_context: ['peer_group', 'patients', 'community', 'complexity', 'state'],
  everything_known: Object.keys(GROUPS).filter(g => g !== 'track_record'),
  with_track_record: Object.keys(GROUPS),
}

export interface PredictorResult {
  hospitals: number
  groups: Record<string, { alone: number; added: number }>
  variables: Record<string, { r: number; n: number; coverage: number }>
  models: Record<string, number>
  noiseShare: number | null
}

export function peerColumns(type: string | null, own: string | null): number[] {
  const t = type ?? ''
  const o = own ?? ''
  const federal = /Veterans|Defense/.test(t)
  return [
    +(t === 'Critical Access Hospitals'),
    +federal,
    +(!federal && t !== 'Acute Care Hospitals' && t !== 'Critical Access Hospitals'),
    +(o === 'Proprietary'),
    +((o.startsWith('Government') && !o.includes('Federal')) || o === 'Tribal'),
    +(o === 'Physician'),
  ]
}

// One standardized column per variable (clipped at the 1st/99th percentile,
// mean 0, SD 1; missing = 0), plus a missing flag when values are missing.
// Variables from the same source share a missing pattern, so identical flags
// are kept once per design.
export function standardize(raw: (number | null)[]): { values: number[]; flag: number[] | null } {
  const vals = raw.filter((v): v is number => v !== null).sort((a, b) => a - b)
  if (vals.length < 2) return { values: raw.map(() => 0), flag: null }
  const lo = vals[Math.floor((vals.length - 1) * 0.01)]
  const hi = vals[Math.ceil((vals.length - 1) * 0.99)]
  const clip = (v: number) => Math.min(hi, Math.max(lo, v))
  const mean = vals.reduce((a, v) => a + clip(v), 0) / vals.length
  const sd = Math.sqrt(vals.reduce((a, v) => a + (clip(v) - mean) ** 2, 0) / vals.length) || 1
  return {
    values: raw.map(v => (v === null ? 0 : (clip(v) - mean) / sd)),
    flag: vals.length < raw.length ? raw.map(v => +(v === null)) : null,
  }
}

// Rows with a usable noise estimate, their scores oriented so higher is
// better, and inverse-variance weights (real spread + sampling noise).
export function weightedScores<R extends PredictorRow>(measureId: string, higherIsBetter: boolean, input: R[]) {
  const method = METHODS[measureId] ?? 'shrunk'
  const floor = NOISE_FLOOR[measureId] ?? 0
  const rows = input.filter(r =>
    method === 'interval' ? r.lowerEstimate !== null && r.higherEstimate !== null : r.cases !== null && r.cases > 0
  )
  const sign = higherIsBetter ? 1 : -1
  const y = rows.map(r => sign * r.score)
  const mean = y.reduce((a, b) => a + b, 0) / y.length
  const varY = y.reduce((a, v) => a + (v - mean) ** 2, 0) / y.length

  let se2: number[]
  let tau2 = 0
  let noiseShare: number | null = null
  if (method === 'interval') se2 = rows.map(r => ((r.higherEstimate! - r.lowerEstimate!) / 3.92) ** 2)
  else if (method === 'binomial') {
    se2 = rows.map(r => {
      const p = Math.min(Math.max(r.score / 100, 0.001), 0.999)
      return (1e4 * p * (1 - p)) / r.cases!
    })
  } else {
    const fit = noiseModel(y.map(v => v - mean), rows.map(r => r.cases!))
    tau2 = Math.max(0, fit.tau2 - floor)
    se2 = rows.map(r => fit.k / r.cases! + floor)
    noiseShare = Math.min(1, se2.reduce((a, b) => a + b, 0) / se2.length / (varY || 1))
  }
  const w = se2.map(s => 1 / (tau2 + s + 1e-9))
  return { rows, y, w, sign, noiseShare }
}

export function analyzePredictors(measureId: string, higherIsBetter: boolean, input: PredictorRow[]): PredictorResult {
  const { rows, y, w, sign, noiseShare } = weightedScores(measureId, higherIsBetter, input)

  const columns: Record<string, ReturnType<typeof standardize>> = {}
  // Missing or unusable values (absent keys, NaN from bad data) become null.
  const value = (name: string, r: PredictorRow) => {
    const v = VARIABLES[name](r.values)
    return v === null || v === undefined || !Number.isFinite(v) ? null : v
  }
  for (const name of Object.keys(VARIABLES)) columns[name] = standardize(rows.map(r => value(name, r)))
  const prior = standardize(rows.map(r => (r.prior === null ? null : sign * r.prior)))
  const peer = rows.map(r => peerColumns(r.hospitalType, r.ownership))

  const design = (groups: string[]): number[][] => {
    const cols: number[][] = []
    const flags = new Set<string>()
    const add = (c: ReturnType<typeof standardize>) => {
      cols.push(c.values)
      if (c.flag && !flags.has(c.flag.join(''))) {
        flags.add(c.flag.join(''))
        cols.push(c.flag)
      }
    }
    for (const g of groups) {
      if (g === 'peer_group') for (let j = 0; j < 6; j++) cols.push(peer.map(p => p[j]))
      else if (g === 'track_record') add(prior)
      else for (const v of GROUPS[g]) add(columns[v])
    }
    return rows.map((_, i) => [1, ...cols.map(c => c[i])])
  }
  const r2 = (groups: string[]) => crossValidatedR2(design(groups), y, w)

  const models = Object.fromEntries(Object.entries(MODELS).map(([name, groups]) => [name, r2(groups)]))
  const known = MODELS.everything_known
  const groups = Object.fromEntries(
    Object.keys(GROUPS).map(g => [g, {
      alone: r2([g]),
      added: g === 'track_record'
        ? models.with_track_record - models.everything_known
        : models.everything_known - r2(known.filter(x => x !== g)),
    }])
  )

  const variables: PredictorResult['variables'] = {}
  for (const name of Object.keys(VARIABLES)) {
    const pairs = rows.map((r, i) => [value(name, r), y[i]] as const).filter(p => p[0] !== null) as [number, number][]
    variables[name] = {
      r: pairs.length > 2 ? pearson(pairs.map(p => p[0]), pairs.map(p => p[1])) : 0,
      n: pairs.length,
      coverage: rows.length ? pairs.length / rows.length : 0,
    }
  }
  const priorPairs = rows.map((r, i) => [r.prior, y[i]] as const).filter(p => p[0] !== null) as [number, number][]
  variables.prior_score = {
    r: priorPairs.length > 2 ? pearson(priorPairs.map(p => sign * p[0]), priorPairs.map(p => p[1])) : 0,
    n: priorPairs.length,
    coverage: rows.length ? priorPairs.length / rows.length : 0,
  }

  return { hospitals: rows.length, groups, variables, models, noiseShare }
}

export interface PeriodScores {
  start: string | null
  end: string
  scores: Map<string, number>
}

// Correlation of each earlier period's scores with the current period's, over
// hospitals scored in both. Orientation doesn't change r (same sign both sides).
export function persistence(current: PeriodScores, earlier: PeriodScores[]) {
  const days = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86_400_000
  return earlier
    .filter(p => p.end < current.end)
    .map(p => {
      const pairs = [...p.scores].filter(([id]) => current.scores.has(id)).map(([id, v]) => [v, current.scores.get(id)!])
      return {
        start: p.start,
        end: p.end,
        yearsBack: days(current.end, p.end) / 365.25,
        overlapping: current.start !== null && p.end >= current.start,
        r: pairs.length > 2 ? pearson(pairs.map(q => q[0]), pairs.map(q => q[1])) : 0,
        n: pairs.length,
      }
    })
    .filter(p => p.n >= 30)
}

const iso = (d: Date | string | null) => (d === null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10))

// Every category measure's current scores with all hospital facts. Extra
// columns (ending in a comma) and joins let exploratory analyses add facts.
export const inputQuery = (extraColumns = '', extraJoins = '') => `
    SELECT s.measure_id, m.higher_is_better, s.facility_id, s.score::float8 AS score, s.denominator AS cases,
           s.lower_estimate::float8 AS lower_estimate, s.higher_estimate::float8 AS higher_estimate,
           s.start_date, s.end_date, h.hospital_type, h.ownership,
           a.avg_inpatient_occupancy::float8 AS st_occupancy, a.avg_resp_admissions_per_100_beds::float8 AS st_respiratory,
           a.stdzd_spend_pc::float8 AS st_spend, a.dual_eligible_pct::float8 AS st_low_income,
           c.dual_proportion AS dual, c.dsh_pct AS dsh, c.svi_percentile AS svi, c.poverty150_pct AS poverty,
           c.uninsured_pct AS uninsured, c.rural::int AS rural, c.case_mix_index AS case_mix,
           c.resident_bed_ratio AS teaching, c.system_hospitals,
           f.patient_margin, f.total_margin, f.other_income_share AS other_income,
           f.uncompensated_share AS uncompensated, f.medicaid_day_share AS medicaid_days, f.occupancy,
           f.fte_per_bed, f.contract_labor_share AS contract_labor, f.cost_per_discharge, f.salary_per_fte,
           f.investments_per_bed, f.fixed_assets_per_bed, f.debt_ratio, f.current_ratio,
           f.beds, hf.total_discharges AS discharges,
           ${extraColumns}(SELECT p.score::float8 FROM measure_score_history p
             WHERE p.facility_id = s.facility_id AND p.measure_id = s.measure_id AND p.end_date < s.start_date
             ORDER BY p.end_date DESC LIMIT 1) AS prior
    FROM analysis_measure_windows w
    JOIN measures m ON m.measure_id = w.measure_id
    JOIN measure_scores s ON s.measure_id = w.measure_id AND s.release_id = w.release_id AND s.score IS NOT NULL
    JOIN hospitals h ON h.facility_id = s.facility_id
    JOIN analysis_state_measure_live a ON a.measure_id = s.measure_id AND a.state = h.state
    LEFT JOIN hospital_context c ON c.facility_id = s.facility_id
    LEFT JOIN hospital_finance_ratios f ON f.facility_id = s.facility_id
    LEFT JOIN hospital_finance hf ON hf.facility_id = s.facility_id
    ${extraJoins}
    WHERE a.avg_inpatient_occupancy IS NOT NULL AND a.stdzd_spend_pc IS NOT NULL AND a.dual_eligible_pct IS NOT NULL`

// Reads inputs for every category measure and writes results under `runId`.
// Runs inside the analyze job's transaction.
export async function writePredictors(db: Client, runId: number): Promise<void> {
  const { rows } = await db.query(inputQuery())
  const { rows: history } = await db.query(`
    SELECT measure_id, facility_id, start_date, end_date, score::float8 AS score
    FROM measure_score_history WHERE measure_id IN (SELECT measure_id FROM analysis_measure_windows)`)

  const numeric = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  const measureIds = [...new Set(rows.map(r => r.measure_id as string))].sort()
  const current = new Map<string, Map<string, number>>()

  for (const measureId of measureIds) {
    const mr = rows.filter(r => r.measure_id === measureId)
    const higherIsBetter: boolean = mr[0].higher_is_better
    const result = analyzePredictors(measureId, higherIsBetter, mr.map(r => ({
      facilityId: r.facility_id, score: r.score, cases: r.cases,
      lowerEstimate: r.lower_estimate, higherEstimate: r.higher_estimate,
      hospitalType: r.hospital_type, ownership: r.ownership, prior: r.prior,
      values: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' || typeof v === 'string' ? numeric(v) : null])),
    })))
    await db.query(
      `INSERT INTO analysis_predictors (run_id, measure_id, hospitals, groups, variables, models, noise_share)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [runId, measureId, result.hospitals, JSON.stringify(result.groups), JSON.stringify(result.variables),
        JSON.stringify(result.models), result.noiseShare]
    )
    const m = result.models
    console.log(`  predictors ${measureId}: assumptions ${(m.assumptions * 100).toFixed(1)}%, fair ${(m.fair_context * 100).toFixed(1)}%, ` +
      `everything ${(m.everything_known * 100).toFixed(1)}%, + track record ${(m.with_track_record * 100).toFixed(1)}%`)

    // Persistence: the current period against every earlier one.
    const sign = higherIsBetter ? 1 : -1
    current.set(measureId, new Map(mr.map(r => [r.facility_id as string, sign * r.score])))
    const periods = new Map<string, PeriodScores>()
    for (const h of history.filter(h => h.measure_id === measureId)) {
      const key = iso(h.end_date)!
      const p = periods.get(key) ?? { start: iso(h.start_date), end: key, scores: new Map() }
      p.scores.set(h.facility_id, h.score)
      periods.set(key, p)
    }
    const cur: PeriodScores = { start: iso(mr[0].start_date), end: iso(mr[0].end_date)!, scores: new Map(mr.map(r => [r.facility_id, r.score])) }
    for (const p of persistence(cur, [...periods.values()])) {
      await db.query(
        `INSERT INTO analysis_persistence (run_id, measure_id, period_start, period_end, years_back, overlapping, r, n)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [runId, measureId, p.start, p.end, p.yearsBack, p.overlapping, p.r, p.n]
      )
    }
  }

  // Is quality one thing? Pairwise, over hospitals with both measures.
  for (const a of measureIds) {
    for (const b of measureIds) {
      if (a >= b) continue
      const A = current.get(a)!
      const B = current.get(b)!
      const ids = [...A.keys()].filter(id => B.has(id))
      if (ids.length < 30) continue
      await db.query(
        'INSERT INTO analysis_measure_correlations (run_id, measure_a, measure_b, r, n) VALUES ($1, $2, $3, $4, $5)',
        [runId, a, b, pearson(ids.map(id => A.get(id)!), ids.map(id => B.get(id)!)), ids.length]
      )
    }
  }
}
