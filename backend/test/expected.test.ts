import { describe, expect, it } from 'vitest'
import { COMPOSITE_CAP, activeColumns, composite, contextScales, features, fitMeasure, verdictOf, type HospitalInput, type HospitalResult } from '../src/analysis/expected'

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32
    return seed / 2 ** 32
  }
}

describe('verdictOf (clear cases only)', () => {
  it('needs the whole 95% interval beyond the margin', () => {
    expect(verdictOf(10, 1, 5)).toBe('better') // 10 - 1.96 > 5
    expect(verdictOf(6, 1, 5)).toBe('as_expected') // statistically > 0, but not clearly past the margin
    expect(verdictOf(-10, 1, 5)).toBe('worse')
    expect(verdictOf(0, 0, 0)).toBe('as_expected')
  })
})

// Synthetic ER-wait hospitals (lower is better): expected time rises 10 min
// per 10 points of state occupancy; critical access hospitals run 40 min
// shorter; each hospital has a real deviation (SD 15) plus sampling noise
// that shrinks with volume.
function synthetic(seed = 11) {
  const r = rng(seed)
  const normal = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())
  const rows: HospitalInput[] = []
  for (let i = 0; i < 3000; i++) {
    const occupancy = 55 + r() * 35
    const cah = r() < 0.3
    const cases = 50 + Math.floor(r() * 950)
    const truth = 100 + occupancy - (cah ? 40 : 0) + 15 * normal()
    rows.push({
      facilityId: `H${i}`, state: ['AL', 'AK', 'AZ'][i % 3], score: truth + (300 / Math.sqrt(cases)) * normal(), cases,
      lowerEstimate: null, higherEstimate: null,
      hospitalType: cah ? 'Critical Access Hospitals' : 'Acute Care Hospitals', ownership: 'Voluntary non-profit - Private',
      occupancy, spend: 10000, stateLowIncome: 0.2,
    })
  }
  // A big hospital that is 80 minutes faster than its context predicts.
  rows.push({ ...rows[0], facilityId: 'STAR', cases: 1000, occupancy: 80, hospitalType: 'Acute Care Hospitals', score: 100 + 80 - 80 })
  // A tiny hospital with the same apparent gap, mostly noise.
  rows.push({ ...rows[0], facilityId: 'LUCKY', cases: 5, occupancy: 80, hospitalType: 'Acute Care Hospitals', score: 100 + 80 - 80 })
  return rows
}

describe('fitMeasure', () => {
  const { summary, results } = fitMeasure('OP_18b', false, synthetic())
  const byId = new Map(results.map(r => [r.facilityId, r]))

  it('recovers the planted context effects', () => {
    const occ = summary.coefficients.occupancy_per_10pt
    const cah = summary.coefficients.critical_access
    expect(Math.abs(occ.estimate - 10)).toBeLessThan(3 * occ.se + 0.5)
    expect(Math.abs(cah.estimate + 40)).toBeLessThan(3 * cah.se + 1)
  })

  it('reports that context matters, and which context', () => {
    expect(summary.r2Cv).toBeGreaterThan(0.3)
    expect(summary.importance.peer_group).toBeGreaterThan(0.05)
    expect(summary.importance.crowding).toBeGreaterThan(0.05)
    // Spending and low-income share were constant here: no explanatory power.
    expect(Math.abs(summary.importance.spending)).toBeLessThan(0.01)
  })

  it('estimates the real hospital-to-hospital spread', () => {
    // True SD is 15. Unbiased across seeds (mean ~14.7 over 16 seeds); the
    // planted 5-case outlier nudges this fixture up a little.
    expect(summary.tau).toBeGreaterThan(12)
    expect(summary.tau).toBeLessThan(19)
  })

  it('orients gaps so faster-than-expected is positive', () => {
    expect(byId.get('STAR')!.gap).toBeGreaterThan(60)
  })

  it('flags a precisely measured outlier but shrinks a tiny lucky one', () => {
    expect(byId.get('STAR')!.verdict).toBe('better')
    expect(byId.get('LUCKY')!.verdict).toBe('as_expected')
    expect(byId.get('LUCKY')!.adjustedGap).toBeLessThan(byId.get('STAR')!.adjustedGap / 2)
  })

  it('labels only a small share of hospitals', () => {
    const flagged = results.filter(r => r.verdict !== 'as_expected').length
    expect(flagged / results.length).toBeLessThan(0.15)
  })
})

describe('composite', () => {
  const result = (facilityId: string, adjustedGap: number, gapSe: number): HospitalResult => ({
    facilityId, state: 'AL', actual: 0, expected: 0, gap: adjustedGap, adjustedGap, gapSe, z: 0, verdict: 'as_expected',
  })
  // 200 ordinary hospitals across 3 measures, plus a consistently strong,
  // precisely measured one and an equally high but very noisy one.
  const r = rng(5)
  const measures = [0, 1, 2].map(() => {
    const rows = Array.from({ length: 200 }, (_, i) => result(`H${i}`, (r() - 0.5) * 4, 0.3))
    rows.push(result('STEADY', 3, 0.3), result('NOISY', 3, 4))
    return { tau: 1, results: rows }
  })
  const ranked = composite(measures)
  const rank = (id: string) => ranked.find(c => c.facilityId === id)!

  it('ranks precise evidence above equally high but noisy evidence', () => {
    expect(rank('STEADY').nationalRank).toBe(1)
    expect(rank('NOISY').nationalRank).toBeGreaterThan(rank('STEADY').nationalRank)
    expect(rank('STEADY').verdict).toBe('better')
    expect(rank('NOISY').verdict).toBe('as_expected')
  })

  it('needs at least three measures', () => {
    const two = composite(measures.slice(0, 2))
    expect(two).toHaveLength(0)
  })

  it('caps any one measure so a single extreme score cannot decide the composite', () => {
    const ms = measures.map((m, k) => ({
      ...m,
      results: [...m.results, result('SPIKE', k === 0 ? -20 : 0.5, 0.3), result('STEADY_BAD', -2.5, 0.3)],
    }))
    const out = composite(ms)
    const spike = out.find(c => c.facilityId === 'SPIKE')!
    // Uncapped, SPIKE averages (-20 + 0.5 + 0.5) / 3 = -6.3; capped, (-3 + 1) / 3.
    expect(COMPOSITE_CAP).toBe(3)
    expect(spike.nationalRank).toBeLessThan(out.find(c => c.facilityId === 'STEADY_BAD')!.nationalRank)
  })
})

describe('hospital-level context', () => {
  const r = rng(23)
  const normal = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())
  // Satisfaction-like measure: 0.3 stars lower per 10 points of dual-eligible
  // share. A third of hospitals have no hospital-level data at all.
  const rows: HospitalInput[] = Array.from({ length: 3000 }, (_, i) => {
    const dual = 0.05 + r() * 0.4
    const known = i % 3 !== 0
    return {
      facilityId: `C${i}`, state: 'AL', score: 3.5 - 3 * (dual - 0.25) + 0.3 * normal(), cases: 100 + Math.floor(r() * 900),
      lowerEstimate: null, higherEstimate: null, hospitalType: 'Acute Care Hospitals',
      ownership: 'Voluntary non-profit - Private', occupancy: 55 + r() * 35, spend: 10000, stateLowIncome: 0.2,
      context: known
        ? { dual, dsh: null, caseMix: null, teaching: null, svi: r(), poverty: null, uninsured: null, rural: false }
        : null,
    }
  })
  const { summary } = fitMeasure('H_COMP_1_STAR_RATING', true, rows)

  it('recovers a planted dual-eligible effect, in readable units', () => {
    const c = summary.coefficients.dual_eligible_per_10pt
    expect(Math.abs(c.estimate + 0.3)).toBeLessThan(3 * c.se + 0.02)
    expect(summary.importance.patients).toBeGreaterThan(0.1)
  })

  it('treats missing values as average and flags them', () => {
    const scales = contextScales(rows)
    const x = features(rows[0], scales)
    const known = features(rows[1], scales)
    expect(x[10]).toBe(0) // dual imputed at the mean
    expect(x[x.length - 2]).toBe(1) // no hospital-level data
    expect(known[known.length - 2]).toBe(0)
  })

  it('uses case mix and teaching only for measures CMS does not risk-adjust', () => {
    const fitted = fitMeasure('MORT_30_AMI', false, rows.map(h => ({ ...h, score: 12 + normal(), cases: 200 })))
    expect(fitted.summary.coefficients.case_mix_per_0_25).toBeUndefined()
    expect(fitted.summary.importance.complexity).toBeUndefined()
    expect(activeColumns('OP_18b').length).toBeGreaterThan(activeColumns('MORT_30_AMI').length)
  })
})
