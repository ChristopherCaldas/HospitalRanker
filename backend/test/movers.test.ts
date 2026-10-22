import { describe, expect, it } from 'vitest'
import { changePredictors, financeFacts, fitMovers, pickPeriods, type ChangeInput, type ScoreRow } from '../src/analysis/movers'
import { ownershipChanges } from '../src/ingest/changes'

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32
    return seed / 2 ** 32
  }
}

describe('pickPeriods', () => {
  it('compares the latest period with the latest separate one at least 2.5 years earlier', () => {
    const periods = ['2018', '2019', '2021', '2022', '2023', '2024'].map(y => ({ start: `${y}-01-01`, end: `${y}-12-31` }))
    periods.push({ start: '2024-10-01', end: '2025-09-30' })
    expect(pickPeriods(periods)).toEqual({
      from: { start: '2022-01-01', end: '2022-12-31' },
      to: { start: '2024-10-01', end: '2025-09-30' },
    })
  })

  it('skips three-year windows that overlap the current one', () => {
    const p = (s: string, e: string) => ({ start: s, end: e })
    const picked = pickPeriods([p('2019-07-01', '2022-06-30'), p('2020-07-01', '2023-06-30'), p('2022-07-01', '2025-06-30')])
    expect(picked?.from.end).toBe('2022-06-30')
    expect(pickPeriods([p('2024-01-01', '2024-12-31')])).toBeNull()
  })
})

// Synthetic ER waits (lower is better): every hospital has a true level that
// drifts a little (SD 20 min), scores add volume-dependent noise, and 40
// hospitals change a lot (20 by 100 minutes faster, 20 by 100 slower).
function synthetic(seed = 3) {
  const r = rng(seed)
  const normal = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())
  const from: ScoreRow[] = []
  const to: ScoreRow[] = []
  for (let i = 0; i < 3000; i++) {
    const cases = 100 + Math.floor(r() * 2000)
    const truth = 150 + 40 * normal()
    const shift = (i < 20 ? -100 : i < 40 ? 100 : 0) + 20 * normal()
    const base = { facilityId: `H${i}`, lowerEstimate: null, higherEstimate: null, hospitalType: 'Acute Care Hospitals', ownership: 'Voluntary non-profit - Private' }
    from.push({ ...base, cases, score: truth + (300 / Math.sqrt(cases)) * normal() })
    to.push({ ...base, cases, score: truth + shift + (300 / Math.sqrt(cases)) * normal() })
  }
  return { from, to }
}

describe('fitMovers', () => {
  const { from, to } = synthetic()
  const { summary, results } = fitMovers('OP_18b', false, from, to)
  const byId = new Map(results.map(r => [r.facilityId, r]))

  it('finds the planted changers and few others', () => {
    const improved = results.filter(r => r.verdict === 'improved').map(r => Number(r.facilityId.slice(1)))
    const declined = results.filter(r => r.verdict === 'declined').map(r => Number(r.facilityId.slice(1)))
    // Small hospitals' big changes stay uncertain, so not all 20 are caught.
    expect(improved.filter(i => i < 20).length).toBeGreaterThan(8)
    expect(declined.filter(i => i >= 20 && i < 40).length).toBeGreaterThan(8)
    expect(improved.filter(i => i >= 40).length + declined.filter(i => i >= 40).length).toBeLessThan(0.03 * 2960)
    expect(improved.filter(i => i >= 20 && i < 40)).toEqual([]) // never the wrong direction
    expect(byId.get('H0')!.change).toBeGreaterThan(0) // + = better: faster
  })

  it('expects bad starters to drift back toward the middle', () => {
    expect(summary.fifths[0].avgChange).toBeGreaterThan(summary.fifths[4].avgChange) // worst fifth "improves" raw
    const steady = results.filter((_, i) => i >= 40)
    const worst = [...steady].sort((a, b) => b.startScore - a.startScore)[0] // longest wait at the start
    expect(worst.expectedEnd).toBeLessThan(worst.startScore)
    expect(summary.hospitals).toBe(3000)
  })
})

describe('changePredictors', () => {
  it('picks up a planted predictor of change and reports ownership effects in tau units', () => {
    const r = rng(9)
    const normal = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())
    const inputs = new Map<string, ChangeInput>()
    const results = Array.from({ length: 1500 }, (_, i) => {
      const marginChange = 0.1 * normal()
      const owner = i % 10 === 0
      const change = 20 * marginChange + (owner ? -1 : 0) + normal()
      inputs.set(`H${i}`, {
        facilityId: `H${i}`, hospitalType: 'Acute Care Hospitals', ownership: 'Voluntary non-profit - Private',
        start: { patient_margin: 0, beds: 5 }, end: { patient_margin: marginChange, beds: 5 }, ownershipChange: owner,
      })
      return { facilityId: `H${i}`, startScore: 0, endScore: 0, expectedEnd: 0, rawChange: change, change, changeSe: 1, verdict: 'steady' as const }
    })
    const out = changePredictors(results, results.map(() => 1), 1, inputs)
    expect(out.groups.finance_change.alone).toBeGreaterThan(0.3)
    expect(out.variables.patient_margin_change.r).toBeGreaterThan(0.5)
    expect(out.ownership.hospitals).toBe(150)
    expect(Math.abs(out.ownership.effect + 1)).toBeLessThan(3 * out.ownership.se + 0.1)
  })
})

describe('financeFacts', () => {
  it('computes ratios and drops implausible ones', () => {
    const f = financeFacts({
      net_income_patient: -50, net_patient_revenue: 1000, net_income: 20, total_other_income: 100, uncompensated_care: 30,
      total_costs: 1000, medicaid_days: 10, total_days: 100, contract_labor: 5, salaries: 100, fte_employees: 0,
      beds: 50, bed_days_available: 50, total_discharges: 0,
    })
    expect(f.patient_margin).toBeCloseTo(-0.05)
    expect(f.total_margin).toBeCloseTo(20 / 1100)
    expect(f.occupancy).toBeNull() // 200% occupancy is a reporting artifact
    expect(f.fte_per_bed).toBe(0)
    expect(f.salary_per_fte).toBeNull()
    expect(f.discharges).toBeNull()
  })
})

describe('ownershipChanges', () => {
  it('reads CMS change-of-ownership rows', () => {
    const rows = ownershipChanges([
      { 'CCN - BUYER': '150056', 'CCN - SELLER': '150161', 'EFFECTIVE DATE': '12/28/2025', 'CHOW TYPE TEXT': 'ACQUISITION/MERGER',
        'ORGANIZATION NAME - BUYER': 'IU HEALTH', 'ORGANIZATION NAME - SELLER': 'IU HEALTH NORTH' },
      { 'CCN - BUYER': '', 'CCN - SELLER': '', 'EFFECTIVE DATE': '01/01/2020' },
    ])
    expect(rows).toEqual([{
      buyerCcn: '150056', sellerCcn: '150161', effectiveDate: '2025-12-28', chowType: 'ACQUISITION/MERGER',
      buyerName: 'IU HEALTH', sellerName: 'IU HEALTH NORTH',
    }])
  })
})
