import type { Client } from 'pg'
import type { HospitalResult } from './expected'
import { SCOPES, scopeScores, type Domain, type QualityGroup, type ScoredMeasure } from './scores'
import { spearman } from './stats'

// Equity: how results and money differ between hospitals that serve many
// low-income patients and those that serve few, and whether the expected
// model's adjustment for patients and community hides real gaps.
//
// Hospitals are split into fifths by dual-eligible share (Medicare patients
// who also have full Medicaid), the grouping CMS's Hospital Readmissions
// Reduction Program uses for its peer groups. Per fifth:
//   scores   mean unadjusted and adjusted score per scope. Unadjusted scores
//            run each measure's raw gap from the national median through the
//            same group/domain weighting as the adjusted ones, so the two are
//            on the same scale (tau units, + = better).
//   money    median finance and staffing figures from the cost reports
//   within   Spearman between money and the adjusted overall score among
//            hospitals in the same fifth: does money go with quality once
//            patient poverty is held roughly constant?
// Per hospital: its rank on the unadjusted overall score within its fifth
// (the HRRP-style comparison), next to the adjusted national rank.
//
// Only hospitals in the CMS payment files have a dual-eligible share (IPPS
// acute hospitals, ~3,000); the rest aren't in any fifth.

export const MONEY_METRICS: Record<string, string> = {
  patient_margin: 'patient_margin',
  total_margin: 'total_margin',
  uncompensated: 'uncompensated_share',
  other_income: 'other_income_share',
  cost_per_discharge: 'cost_per_discharge',
  fte_per_bed: 'fte_per_bed',
  salary_per_fte: 'salary_per_fte',
  contract_labor: 'contract_labor_share',
}

export interface EquityMeasure {
  measureId: string
  group: QualityGroup
  domain: Domain
  higherIsBetter: boolean
  tau: number
  rows: { facilityId: string; state: string; actual: number; adjustedGap: number; gapSe: number }[]
}

export interface FifthRow {
  fifth: number
  dualLow: number
  dualHigh: number
  hospitals: number
  scores: Record<string, { raw: number | null; adjusted: number | null; n: number }>
  money: Record<string, { median: number | null; n: number }>
  within: Record<string, { spearman: number | null; n: number }>
}

export interface PeerRow {
  facilityId: string
  fifth: number
  rawScore: number
  peerRank: number
  peerCount: number
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length

// Each measure's unadjusted gap: oriented distance from the national median.
export function rawMeasures(measures: EquityMeasure[]): ScoredMeasure[] {
  return measures.map(m => {
    const center = median(m.rows.map(r => r.actual)) ?? 0
    const sign = m.higherIsBetter ? 1 : -1
    const results: HospitalResult[] = m.rows.map(r => {
      const gap = sign * (r.actual - center)
      return {
        facilityId: r.facilityId, state: r.state, actual: r.actual, expected: center, gap,
        adjustedGap: gap, gapSe: r.gapSe, z: 0, verdict: 'as_expected',
      }
    })
    return { measureId: m.measureId, group: m.group, domain: m.domain, tau: m.tau, results }
  })
}

// Fifth 1 = lowest dual-eligible share, 5 = highest.
export function assignFifths(dual: Map<string, number>): Map<string, number> {
  const sorted = [...dual.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
  return new Map(sorted.map(([id], i) => [id, Math.floor((i * 5) / sorted.length) + 1]))
}

export function equityAnalysis(
  measures: EquityMeasure[],
  dual: Map<string, number>,
  money: Map<string, Record<string, number | null>>
): { fifths: FifthRow[]; peers: PeerRow[] } {
  const fifthOf = assignFifths(dual)
  const adjusted: ScoredMeasure[] = measures.map(m => ({
    measureId: m.measureId, group: m.group, domain: m.domain, tau: m.tau,
    results: m.rows.map(r => ({
      facilityId: r.facilityId, state: r.state, actual: r.actual, expected: 0, gap: r.adjustedGap,
      adjustedGap: r.adjustedGap, gapSe: r.gapSe, z: 0, verdict: 'as_expected' as const,
    })),
  }))
  const raw = rawMeasures(measures)
  const scopeNames = Object.keys(SCOPES)
  const rawScores = Object.fromEntries(scopeNames.map(s => [s, new Map(scopeScores(raw, SCOPES[s]).map(r => [r.facilityId, r.score]))]))
  const adjScores = Object.fromEntries(scopeNames.map(s => [s, new Map(scopeScores(adjusted, SCOPES[s]).map(r => [r.facilityId, r.score]))]))

  const fifths: FifthRow[] = [1, 2, 3, 4, 5].map(fifth => {
    const ids = [...fifthOf.entries()].filter(([, f]) => f === fifth).map(([id]) => id)
    const duals = ids.map(id => dual.get(id)!)
    const scores = Object.fromEntries(scopeNames.map(s => {
      const r = ids.map(id => rawScores[s].get(id)).filter((v): v is number => v !== undefined)
      const a = ids.map(id => adjScores[s].get(id)).filter((v): v is number => v !== undefined)
      return [s, { raw: mean(r), adjusted: mean(a), n: a.length }]
    }))
    const moneyRows = Object.fromEntries(Object.keys(MONEY_METRICS).map(k => {
      const vals = ids.map(id => money.get(id)?.[k]).filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v))
      return [k, { median: median(vals), n: vals.length }]
    }))
    const within = Object.fromEntries(Object.keys(MONEY_METRICS).map(k => {
      const pairs = ids.flatMap(id => {
        const x = money.get(id)?.[k]
        const y = adjScores.overall.get(id)
        return x === null || x === undefined || !Number.isFinite(x) || y === undefined ? [] : [[x, y] as const]
      })
      return [k, { spearman: pairs.length >= 30 ? spearman(pairs.map(p => p[0]), pairs.map(p => p[1])) : null, n: pairs.length }]
    }))
    return {
      fifth, dualLow: Math.min(...duals), dualHigh: Math.max(...duals), hospitals: ids.length,
      scores, money: moneyRows, within,
    }
  })

  const peers: PeerRow[] = []
  for (const fifth of [1, 2, 3, 4, 5]) {
    const ranked = [...fifthOf.entries()]
      .filter(([id, f]) => f === fifth && rawScores.overall.has(id))
      .map(([id]) => ({ id, score: rawScores.overall.get(id)! }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    ranked.forEach((r, i) => peers.push({ facilityId: r.id, fifth, rawScore: r.score, peerRank: i + 1, peerCount: ranked.length }))
  }
  return { fifths, peers }
}

// Reads this run's expected-model results, dual-eligible shares and cost
// reports; writes the equity tables. Runs inside the analyze job's transaction.
export async function writeEquity(db: Client, runId: number): Promise<void> {
  const { rows } = await db.query(
    `SELECT e.measure_id, m.quality_group, m.domain, m.higher_is_better, mm.tau, e.facility_id, h.state,
            e.actual, e.adjusted_gap, e.gap_se
     FROM analysis_hospital_expected e
     JOIN analysis_expected_models mm ON mm.run_id = e.run_id AND mm.measure_id = e.measure_id
     JOIN measures m ON m.measure_id = e.measure_id
     JOIN hospitals h ON h.facility_id = e.facility_id
     WHERE e.run_id = $1 AND mm.tau > 0`, [runId])
  const byMeasure = new Map<string, EquityMeasure>()
  for (const r of rows) {
    if (!byMeasure.has(r.measure_id)) {
      byMeasure.set(r.measure_id, {
        measureId: r.measure_id, group: r.quality_group, domain: r.domain, higherIsBetter: r.higher_is_better,
        tau: r.tau, rows: [],
      })
    }
    byMeasure.get(r.measure_id)!.rows.push({
      facilityId: r.facility_id, state: r.state, actual: r.actual, adjustedGap: r.adjusted_gap, gapSe: r.gap_se,
    })
  }

  const scored = new Set(rows.map(r => r.facility_id as string))
  const { rows: duals } = await db.query('SELECT facility_id, dual_proportion FROM hospital_context WHERE dual_proportion IS NOT NULL')
  const dual = new Map(duals.filter(r => scored.has(r.facility_id)).map(r => [r.facility_id as string, Number(r.dual_proportion)]))
  const { rows: fin } = await db.query(
    `SELECT facility_id, ${Object.values(MONEY_METRICS).map(c => `${c}::float8 AS ${c}`).join(', ')} FROM hospital_finance_ratios`)
  const money = new Map(fin.map(r => [
    r.facility_id as string,
    Object.fromEntries(Object.entries(MONEY_METRICS).map(([k, c]) => [k, r[c] === null ? null : Number(r[c])])),
  ]))

  const { fifths, peers } = equityAnalysis([...byMeasure.values()], dual, money)
  for (const f of fifths) {
    await db.query(
      `INSERT INTO analysis_equity_fifths (run_id, fifth, dual_low, dual_high, hospitals, scores, money, within)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [runId, f.fifth, f.dualLow, f.dualHigh, f.hospitals, JSON.stringify(f.scores), JSON.stringify(f.money), JSON.stringify(f.within)]
    )
    const o = f.scores.overall
    console.log(`  equity fifth ${f.fifth} (dual ${(f.dualLow * 100).toFixed(0)}–${(f.dualHigh * 100).toFixed(0)}%): ` +
      `${f.hospitals} hospitals, overall raw ${o.raw?.toFixed(2)} vs adjusted ${o.adjusted?.toFixed(2)}, ` +
      `median total margin ${((f.money.total_margin.median ?? 0) * 100).toFixed(1)}%`)
  }
  const col = <K extends keyof PeerRow>(k: K) => peers.map(p => p[k])
  await db.query(
    `INSERT INTO analysis_hospital_peer (run_id, facility_id, fifth, raw_score, peer_rank, peer_count)
     SELECT $1, * FROM unnest($2::text[], $3::int[], $4::float8[], $5::int[], $6::int[])`,
    [runId, col('facilityId'), col('fifth'), col('rawScore'), col('peerRank'), col('peerCount')]
  )
}
