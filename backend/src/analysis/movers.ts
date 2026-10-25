import type { Client } from 'pg'
import { crossValidatedR2, noiseModel, pearson, wls, wlsWithSe } from './stats'

// "Movers": which hospitals really got better or worse between two separate
// measurement periods, and can anything predict who changes?
//
// Per measure: the current period vs. the latest earlier period that shares
// no months with it and ended at least MIN_YEARS_APART before it.
//
// A raw before/after comparison is misleading twice over:
//   - sampling noise: a small hospital's score jumps around by luck;
//   - regression to the mean: the hospitals that looked worst last time were,
//     on average, partly unlucky, so they "improve" next time without
//     changing anything (and the best ones "decline").
// So each hospital's end score is compared with what regression to the mean
// alone predicts from its start score (the start score shrunk for its own
// noise, then a fitted line from start to end). The difference is its change.
// Changes get the same treatment as gaps in the expected-score model:
// shrunk for noise on raw measures (CMS's published rates are already
// shrunk), and "clear cases only": improved/declined only if the 95%
// interval lies beyond one SD of real changes (tau).
//
// Then: does anything predict the change? Finances, staffing and size at the
// start, changes in them between the periods (yearly cost reports), and
// whether the hospital changed owners (CMS change-of-ownership records).

export type Method = 'shrunk' | 'binomial' | 'interval'
export type MoverVerdict = 'improved' | 'steady' | 'declined'

const METHODS: Record<string, Method> = {
  OP_18b: 'shrunk',
  H_COMP_1_STAR_RATING: 'shrunk',
  MORT_30_AMI: 'binomial',
  READM_30_HF: 'binomial',
  PSI_90: 'interval',
}
const NOISE_FLOOR: Record<string, number> = { H_COMP_1_STAR_RATING: 1 / 12 }
const Z_95 = 1.96
export const MIN_YEARS_APART = 2.5

export interface Period {
  start: string
  end: string
}

// The current (latest) period and the latest earlier one that doesn't overlap
// it and ended at least MIN_YEARS_APART earlier.
export function pickPeriods(periods: Period[]): { from: Period; to: Period } | null {
  const sorted = [...periods].sort((a, b) => a.end.localeCompare(b.end))
  const to = sorted[sorted.length - 1]
  if (!to) return null
  const cutoff = new Date(Date.parse(to.end) - MIN_YEARS_APART * 365.25 * 86_400_000).toISOString().slice(0, 10)
  const from = [...sorted].reverse().find(p => p.end <= cutoff && p.end < to.start)
  return from ? { from, to } : null
}

export interface ScoreRow {
  facilityId: string
  score: number
  cases: number | null
  lowerEstimate: number | null
  higherEstimate: number | null
  hospitalType: string | null
  ownership: string | null
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

// Sampling variance of each score in one period (null = can't tell).
// Raw measures: noise ~ k/n, fitted on residuals after removing real
// differences tied to hospital type and size (small hospitals really do
// score differently, which would otherwise be mistaken for noise).
export function samplingVariance(measureId: string, rows: ScoreRow[]): Map<string, number | null> {
  const method = METHODS[measureId] ?? 'shrunk'
  if (method === 'interval') {
    return new Map(rows.map(r => [r.facilityId, r.lowerEstimate !== null && r.higherEstimate !== null
      ? ((r.higherEstimate - r.lowerEstimate) / (2 * Z_95)) ** 2 : null]))
  }
  if (method === 'binomial') {
    return new Map(rows.map(r => {
      const p = Math.min(Math.max(r.score / 100, 0.001), 0.999)
      return [r.facilityId, r.cases ? (1e4 * p * (1 - p)) / r.cases : null]
    }))
  }
  const ok = rows.filter(r => r.cases && r.cases > 0)
  const X = ok.map(r => [1, ...peerColumns(r.hospitalType, r.ownership), Math.log(r.cases!), Math.log(r.cases!) ** 2])
  const beta = wls(X, ok.map(r => r.score), ok.map(() => 1))
  const fit = noiseModel(ok.map((r, i) => r.score - X[i].reduce((a, v, j) => a + v * beta[j], 0)), ok.map(r => r.cases!))
  const floor = NOISE_FLOOR[measureId] ?? 0
  return new Map(rows.map(r => [r.facilityId, r.cases && r.cases > 0 ? fit.k / r.cases + floor : null]))
}

export interface MoverResult {
  facilityId: string
  startScore: number
  endScore: number
  expectedEnd: number
  rawChange: number // end - expected end, oriented, before shrinkage
  change: number
  changeSe: number
  verdict: MoverVerdict
}

export interface MoverSummary {
  hospitals: number
  rtmSlope: number
  tau: number
  improved: number
  declined: number
  detectable: number
  rawJumps: number
  rawDrops: number
  fifths: { fifth: number; hospitals: number; avgChange: number; se: number }[]
}

// Fifth (0 = worst ... 4 = best) of each oriented value; ties broken by order.
function fifths(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out = new Array<number>(values.length)
  order.forEach(([, i], rank) => (out[i] = Math.min(4, Math.floor((rank * 5) / values.length))))
  return out
}

export function fitMovers(
  measureId: string,
  higherIsBetter: boolean,
  from: ScoreRow[],
  to: ScoreRow[]
): { summary: MoverSummary; results: MoverResult[]; weights: number[] } {
  const method = METHODS[measureId] ?? 'shrunk'
  const sign = higherIsBetter ? 1 : -1
  const seFrom = samplingVariance(measureId, from)
  const seTo = samplingVariance(measureId, to)
  const end = new Map(to.map(r => [r.facilityId, r]))
  const pairs = from.filter(r => end.has(r.facilityId) && seFrom.get(r.facilityId) != null && seTo.get(r.facilityId) != null)

  const a = pairs.map(r => sign * r.score)
  const b = pairs.map(r => sign * end.get(r.facilityId)!.score)
  const sa = pairs.map(r => seFrom.get(r.facilityId)!)
  const sb = pairs.map(r => seTo.get(r.facilityId)!)
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length)
  const meanA = mean(a)
  const varA = mean(a.map(v => (v - meanA) ** 2))

  // Shrink each start score for its own noise (raw measures only; CMS's
  // rates are already shrunk), then fit end on shrunk start: that line is
  // what regression to the mean alone predicts.
  const tauA2 = method === 'shrunk' ? Math.max(1e-9, varA - mean(sa)) : varA
  const reliability = sa.map(s => (method === 'shrunk' ? tauA2 / (tauA2 + s) : 1))
  const aShrunk = a.map((v, i) => meanA + reliability[i] * (v - meanA))
  const [alpha, slope] = wls(aShrunk.map(v => [1, v]), b, b.map(() => 1))
  const expected = aShrunk.map(v => alpha + slope * v)
  const resid = b.map((v, i) => v - expected[i])
  // Noise in the residual: the end score's, plus what's left in the start score.
  const s2 = pairs.map((_, i) => sb[i] + slope ** 2 * reliability[i] * sa[i])
  const varR = mean(resid.map(v => v * v))
  const tau2 = method === 'shrunk' ? Math.max(1e-9, varR - mean(s2)) : varR
  const tau = Math.sqrt(tau2)

  const results = pairs.map((r, i): MoverResult => {
    const post = method === 'shrunk'
      ? { mean: (resid[i] * tau2) / (tau2 + s2[i]), sd: Math.sqrt((tau2 * s2[i]) / (tau2 + s2[i])) }
      : { mean: resid[i], sd: Math.sqrt((tau2 * s2[i]) / (tau2 + s2[i])) }
    const verdict: MoverVerdict =
      post.mean - Z_95 * post.sd > tau ? 'improved' : post.mean + Z_95 * post.sd < -tau ? 'declined' : 'steady'
    return {
      facilityId: r.facilityId,
      startScore: r.score,
      endScore: end.get(r.facilityId)!.score,
      expectedEnd: sign * expected[i],
      rawChange: resid[i],
      change: post.mean,
      changeSe: post.sd,
      verdict,
    }
  })

  const fa = fifths(a)
  const fb = fifths(b)
  const byFifth = [0, 1, 2, 3, 4].map(f => {
    const d = b.map((v, i) => v - a[i]).filter((_, i) => fa[i] === f)
    const m = mean(d)
    const sd = Math.sqrt(mean(d.map(v => (v - m) ** 2)))
    return { fifth: f + 1, hospitals: d.length, avgChange: m, se: d.length > 1 ? sd / Math.sqrt(d.length) : 0 }
  })

  return {
    summary: {
      hospitals: pairs.length,
      rtmSlope: slope,
      tau,
      improved: results.filter(r => r.verdict === 'improved').length,
      declined: results.filter(r => r.verdict === 'declined').length,
      detectable: results.filter(r => Math.abs(r.change) > Z_95 * r.changeSe).length,
      rawJumps: pairs.filter((_, i) => fa[i] === 0 && fb[i] === 4).length,
      rawDrops: pairs.filter((_, i) => fa[i] === 4 && fb[i] === 0).length,
      fifths: byFifth,
    },
    results,
    // For the change model: real-change variance plus each hospital's noise.
    weights: s2.map(s => 1 / (tau2 + s)),
  }
}

// --- What predicts change? ---

// Plausible bounds for cost-report ratios; values outside are artifacts.
export const FINANCE_BOUNDS: Record<string, [number, number]> = {
  patient_margin: [-1, 1],
  total_margin: [-1, 1],
  uncompensated: [0, 1],
  medicaid_days: [0, 1],
  contract_labor: [0, 1],
  fte_per_bed: [0, 30],
  occupancy: [0, 1.2],
  salary_per_fte: [10_000, 400_000],
  beds: [0, 9], // log
  discharges: [0, 12], // log
}

export type Facts = Record<string, number | null>

export interface ChangeInput {
  facilityId: string
  hospitalType: string | null
  ownership: string | null
  start: Facts | null // FINANCE_BOUNDS keys, from the cost report nearest the start period
  end: Facts | null
  ownershipChange: boolean
}

export const CHANGE_GROUPS: Record<string, { at: 'start' | 'change' | 'event' | 'peer'; vars: string[] }> = {
  peer_group: { at: 'peer', vars: [] },
  size_at_start: { at: 'start', vars: ['beds', 'discharges'] },
  finances_at_start: { at: 'start', vars: ['patient_margin', 'total_margin', 'uncompensated', 'medicaid_days'] },
  staffing_at_start: { at: 'start', vars: ['contract_labor', 'fte_per_bed', 'occupancy', 'salary_per_fte'] },
  size_change: { at: 'change', vars: ['beds', 'discharges'] },
  finance_change: { at: 'change', vars: ['patient_margin', 'total_margin', 'uncompensated', 'medicaid_days'] },
  staffing_change: { at: 'change', vars: ['contract_labor', 'fte_per_bed', 'occupancy', 'salary_per_fte'] },
  ownership_change: { at: 'event', vars: ['ownership_change'] },
}

export interface ChangePredictors {
  groups: Record<string, { alone: number; added: number }>
  variables: Record<string, { r: number; n: number }>
  everything: number
  ownership: { hospitals: number; effect: number; se: number; improved: number; declined: number }
}

export function changePredictors(results: MoverResult[], weights: number[], tau: number, inputs: Map<string, ChangeInput>): ChangePredictors {
  const rows = results.map(r => inputs.get(r.facilityId)!)
  // Unshrunk change (shrinkage would pull small hospitals' changes to 0 and
  // hide any relationship); the weights already discount noisy hospitals.
  const y = results.map(r => r.rawChange)
  const valueOf = (at: 'start' | 'change' | 'event', v: string) => (x: ChangeInput): number | null => {
    if (at === 'event') return +x.ownershipChange
    const s = x.start?.[v] ?? null
    if (at === 'start') return s
    const e = x.end?.[v] ?? null
    return s === null || e === null ? null : e - s
  }
  const column = (raw: (number | null)[]) => {
    const vals = raw.filter((v): v is number => v !== null).sort((p, q) => p - q)
    if (vals.length < 30) return null
    const lo = vals[Math.floor((vals.length - 1) * 0.01)]
    const hi = vals[Math.ceil((vals.length - 1) * 0.99)]
    const clip = (v: number) => Math.min(hi, Math.max(lo, v))
    const m = vals.reduce((s, v) => s + clip(v), 0) / vals.length
    const sd = Math.sqrt(vals.reduce((s, v) => s + (clip(v) - m) ** 2, 0) / vals.length) || 1
    return { z: raw.map(v => (v === null ? 0 : (clip(v) - m) / sd)), missing: raw.map(v => +(v === null)) }
  }
  const design = (groups: string[]) => {
    const cols: number[][] = []
    const flags = new Set<string>()
    for (const g of groups) {
      const { at, vars } = CHANGE_GROUPS[g]
      if (at === 'peer') {
        for (let j = 0; j < 6; j++) cols.push(rows.map(x => peerColumns(x.hospitalType, x.ownership)[j]))
        continue
      }
      for (const v of vars) {
        const c = column(rows.map(valueOf(at, v)))
        if (!c) continue
        cols.push(c.z)
        const key = c.missing.join('')
        if (c.missing.some(Boolean) && !flags.has(key)) {
          flags.add(key)
          cols.push(c.missing)
        }
      }
    }
    return rows.map((_, i) => [1, ...cols.map(c => c[i])])
  }
  const r2 = (groups: string[]) => (groups.length ? crossValidatedR2(design(groups), y, weights) : 0)
  const all = Object.keys(CHANGE_GROUPS)
  const everything = r2(all)
  const groups = Object.fromEntries(all.map(g => [g, { alone: r2([g]), added: everything - r2(all.filter(x => x !== g)) }]))

  const variables: ChangePredictors['variables'] = {}
  for (const [g, { at, vars }] of Object.entries(CHANGE_GROUPS)) {
    if (at === 'peer') continue
    for (const v of vars) {
      const key = at === 'event' ? v : `${v}_${at}`
      const pairs = rows.map((x, i) => [valueOf(at, v)(x), y[i]] as const).filter(p => p[0] !== null) as [number, number][]
      variables[key] = { r: pairs.length > 2 ? pearson(pairs.map(p => p[0]), pairs.map(p => p[1])) : 0, n: pairs.length }
    }
    void g
  }

  // Ownership change, holding hospital type and ownership fixed; in units of tau.
  const X = rows.map(x => [1, ...peerColumns(x.hospitalType, x.ownership), +x.ownershipChange])
  const changed = rows.filter(x => x.ownershipChange).length
  let effect = 0
  let se = 0
  if (changed >= 5 && tau > 0) {
    const fit = wlsWithSe(X, y, weights)
    const k = fit.beta.length - 1
    effect = fit.beta[k] / tau
    se = fit.se[k] / tau
  }
  return {
    groups,
    variables,
    everything,
    ownership: {
      hospitals: changed,
      effect,
      se,
      improved: results.filter((r, i) => rows[i].ownershipChange && r.verdict === 'improved').length,
      declined: results.filter((r, i) => rows[i].ownershipChange && r.verdict === 'declined').length,
    },
  }
}

// Cost-report ratios for the change model, clipped to FINANCE_BOUNDS.
export function financeFacts(f: Record<string, number | null>): Facts {
  const ratio = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b)
  const log = (v: number | null) => (v === null || v <= 0 ? null : Math.log(v))
  const raw: Facts = {
    patient_margin: ratio(f.net_income_patient, f.net_patient_revenue),
    total_margin: ratio(f.net_income, f.net_patient_revenue === null ? null : f.net_patient_revenue + (f.total_other_income ?? 0)),
    uncompensated: ratio(f.uncompensated_care, f.total_costs),
    medicaid_days: ratio(f.medicaid_days, f.total_days),
    contract_labor: ratio(f.contract_labor, f.salaries),
    fte_per_bed: ratio(f.fte_employees, f.beds),
    occupancy: ratio(f.total_days, f.bed_days_available),
    salary_per_fte: ratio(f.salaries, f.fte_employees),
    beds: log(f.beds),
    discharges: log(f.total_discharges),
  }
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => {
    const [lo, hi] = FINANCE_BOUNDS[k]
    return [k, v === null || !Number.isFinite(v) || v < lo || v > hi ? null : v]
  }))
}

const iso = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10))
// Cost-report file year for a period: the year of its midpoint, capped to the files available.
const fileYear = (p: Period, years: number[]) => {
  const y = new Date((Date.parse(p.start) + Date.parse(p.end)) / 2).getUTCFullYear()
  return Math.min(Math.max(y, Math.min(...years)), Math.max(...years))
}

// Reads history, cost reports and ownership changes; writes results under
// `runId`. Runs inside the analyze job's transaction.
export async function writeMovers(db: Client, runId: number): Promise<void> {
  const { rows: history } = await db.query(`
    SELECT s.measure_id, m.higher_is_better, s.facility_id, s.start_date, s.end_date, s.score::float8 AS score,
           s.denominator AS cases, s.lower_estimate::float8 AS lower_estimate, s.higher_estimate::float8 AS higher_estimate,
           h.hospital_type, h.ownership
    FROM measure_score_history s
    JOIN measures m USING (measure_id)
    JOIN hospitals h USING (facility_id)
    WHERE m.category IS NOT NULL AND s.measure_id IN (SELECT measure_id FROM analysis_measure_windows)
      AND s.start_date IS NOT NULL`)
  const { rows: finRows } = await db.query('SELECT * FROM hospital_finance_history')
  const { rows: chows } = await db.query('SELECT buyer_ccn, seller_ccn, effective_date FROM hospital_ownership_changes')

  const years = [...new Set(finRows.map(r => r.file_year as number))]
  const finance = new Map<string, Facts>(finRows.map(r => [`${r.facility_id}|${r.file_year}`, financeFacts(r)]))
  const changesBy = new Map<string, string[]>()
  for (const c of chows) {
    for (const id of new Set([c.buyer_ccn, c.seller_ccn].filter(Boolean))) {
      changesBy.set(id, [...(changesBy.get(id) ?? []), iso(c.effective_date)])
    }
  }

  for (const measureId of [...new Set(history.map(r => r.measure_id as string))].sort()) {
    const mh = history.filter(r => r.measure_id === measureId)
    const periods = [...new Map(mh.map(r => [iso(r.end_date), { start: iso(r.start_date), end: iso(r.end_date) }])).values()]
    const picked = pickPeriods(periods)
    if (!picked) continue
    const toRow = (r: (typeof mh)[number]): ScoreRow => ({
      facilityId: r.facility_id, score: r.score, cases: r.cases, lowerEstimate: r.lower_estimate,
      higherEstimate: r.higher_estimate, hospitalType: r.hospital_type, ownership: r.ownership,
    })
    const from = mh.filter(r => iso(r.end_date) === picked.from.end).map(toRow)
    const to = mh.filter(r => iso(r.end_date) === picked.to.end).map(toRow)
    const { summary, results, weights } = fitMovers(measureId, mh[0].higher_is_better, from, to)
    if (results.length < 30) continue

    const y0 = years.length ? fileYear(picked.from, years) : 0
    const y1 = years.length ? fileYear(picked.to, years) : 0
    const typeOf = new Map(from.map(r => [r.facilityId, r]))
    const inputs = new Map(results.map(r => {
      const h = typeOf.get(r.facilityId)!
      const changed = (changesBy.get(r.facilityId) ?? []).some(d => d > picked.from.end && d <= picked.to.end)
      return [r.facilityId, {
        facilityId: r.facilityId, hospitalType: h.hospitalType, ownership: h.ownership,
        start: finance.get(`${r.facilityId}|${y0}`) ?? null, end: finance.get(`${r.facilityId}|${y1}`) ?? null,
        ownershipChange: changed,
      } satisfies ChangeInput]
    }))
    const predictors = changePredictors(results, weights, summary.tau, inputs)

    const col = <K extends keyof MoverResult>(k: K) => results.map(r => r[k])
    await db.query(
      `INSERT INTO analysis_movers (run_id, measure_id, facility_id, start_score, end_score, expected_end, change, change_se, verdict, ownership_change)
       SELECT $1, $2, * FROM unnest($3::text[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::float8[], $9::text[], $10::boolean[])`,
      [runId, measureId, col('facilityId'), col('startScore'), col('endScore'), col('expectedEnd'), col('change'),
        col('changeSe'), col('verdict'), results.map(r => inputs.get(r.facilityId)!.ownershipChange)]
    )
    const { ownership, ...rest } = predictors
    await db.query(
      `INSERT INTO analysis_mover_models (run_id, measure_id, start_period, end_period, hospitals, rtm_slope, tau, improved,
                                          declined, detectable, raw_jumps, raw_drops, fifths, predictors, ownership)
       VALUES ($1, $2, daterange($3, $4, '[]'), daterange($5, $6, '[]'), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [runId, measureId, picked.from.start, picked.from.end, picked.to.start, picked.to.end, summary.hospitals,
        summary.rtmSlope, summary.tau, summary.improved, summary.declined, summary.detectable, summary.rawJumps,
        summary.rawDrops, JSON.stringify(summary.fifths), JSON.stringify(rest), JSON.stringify(ownership)]
    )
    console.log(`  movers ${measureId} ${picked.from.end} -> ${picked.to.end}: ${summary.hospitals} hospitals, ` +
      `improved ${summary.improved}, declined ${summary.declined}, detectable ${summary.detectable}; ` +
      `change predicted ${(predictors.everything * 100).toFixed(1)}%; ownership change ${ownership.hospitals} ` +
      `(${ownership.effect.toFixed(2)} ± ${(Z_95 * ownership.se).toFixed(2)} tau)`)
  }
}
