import { describe, expect, it } from 'vitest'
import { COMPOSITE_CAP, type HospitalResult } from '../src/analysis/expected'
import { GROUP_WEIGHTS, SCOPES, allScopes, scopeScores, type ScoredMeasure } from '../src/analysis/scores'

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32
    return seed / 2 ** 32
  }
}

const result = (facilityId: string, adjustedGap: number, gapSe: number): HospitalResult => ({
  facilityId, state: 'AL', actual: 0, expected: 0, gap: adjustedGap, adjustedGap, gapSe, z: 0, verdict: 'as_expected',
})

const measure = (measureId: string, group: ScoredMeasure['group'], domain: ScoredMeasure['domain'], results: HospitalResult[]): ScoredMeasure =>
  ({ measureId, group, domain, tau: 1, results })

describe('scopeScores', () => {
  it('averages within a group before weighting groups, CMS style', () => {
    // Six mortality measures at +1 and one readmission and one safety measure at -1:
    // per measure that's 6 vs 2, but per group 1 group vs 2.
    const ms = [
      ...[1, 2, 3, 4, 5, 6].map(i => measure(`MORT_${i}`, 'mortality', 'outcome', [result('A', 1, 0.1)])),
      measure('READM', 'readmission', 'outcome', [result('A', -1, 0.1)]),
      measure('HAI', 'safety', 'outcome', [result('A', -1, 0.1)]),
    ]
    const [a] = scopeScores(ms, SCOPES.overall)
    expect(a.measures).toBe(8)
    expect(a.groups).toBe(3)
    expect(a.score).toBeCloseTo(-1 / 3, 10)
  })

  it('weights timely and effective care less than the outcome groups', () => {
    const ms = [
      measure('MORT', 'mortality', 'outcome', [result('A', 1, 0.1)]),
      measure('READM', 'readmission', 'outcome', [result('A', 1, 0.1)]),
      measure('OP_18b', 'timely_effective', 'process', [result('A', -2, 0.1)]),
    ]
    const w = GROUP_WEIGHTS
    const [a] = scopeScores(ms, SCOPES.overall)
    expect(a.score).toBeCloseTo((w.mortality + w.readmission - 2 * w.timely_effective) / (w.mortality + w.readmission + w.timely_effective), 10)
  })

  it('needs three groups overall and both groups for process', () => {
    const two = [
      measure('MORT', 'mortality', 'outcome', [result('A', 1, 0.1)]),
      measure('READM', 'readmission', 'outcome', [result('A', 1, 0.1)]),
      measure('READM2', 'readmission', 'outcome', [result('A', 1, 0.1)]),
    ]
    expect(scopeScores(two, SCOPES.overall)).toHaveLength(0)
    const scopes = allScopes([
      ...two,
      measure('SEP_1', 'timely_effective', 'process', [result('A', 1, 0.1)]),
      measure('OP_18b', 'timely_effective', 'process', [result('A', 1, 0.1)]),
      measure('IMM_3', 'timely_effective', 'process', [result('A', 1, 0.1)]),
    ])
    expect(scopes.overall).toHaveLength(1)
    expect(scopes.process).toHaveLength(0) // no patient-reported process
    expect(scopes.outcome).toHaveLength(1)
    expect(scopes.timely_effective).toHaveLength(1)
  })

  it('keeps survey noise from cancelling out across items', () => {
    const items = [1, 2, 3, 4].map(i => measure(`H_${i}`, 'experience', 'process', [result('A', 0, 0.4)]))
    const deaths = [1, 2, 3, 4].map(i => measure(`MORT_${i}`, 'mortality', 'outcome', [result('A', 0, 0.4)]))
    expect(scopeScores(items, SCOPES.experience)[0].scoreSe).toBeCloseTo(0.4, 10)
    expect(scopeScores(deaths, SCOPES.mortality)[0].scoreSe).toBeCloseTo(0.2, 10)
  })

  // 200 ordinary hospitals across three groups, plus a consistently strong,
  // precisely measured one and an equally high but very noisy one.
  const r = rng(5)
  const groups = ['mortality', 'readmission', 'safety'] as const
  const ms = groups.map(g => {
    const rows = Array.from({ length: 200 }, (_, i) => result(`H${i}`, (r() - 0.5) * 2, 0.3))
    rows.push(result('STEADY', 2.5, 0.2), result('NOISY', 2.4, 3))
    return measure(g, g, 'outcome', rows)
  })
  const ranked = scopeScores(ms, SCOPES.overall)
  const find = (id: string) => ranked.find(c => c.facilityId === id)!

  it('labels only clear cases', () => {
    expect(find('STEADY').nationalRank).toBe(1)
    expect(find('STEADY').verdict).toBe('better')
    expect(find('NOISY').verdict).toBe('as_expected')
  })

  it('caps any one measure so a single extreme score cannot decide the score', () => {
    const spiked = ms.map((m, k) => ({
      ...m,
      results: [...m.results, result('SPIKE', k === 0 ? -20 : 0.5, 0.3), result('STEADY_BAD', -2.5, 0.3)],
    }))
    const out = scopeScores(spiked, SCOPES.overall)
    // Uncapped, SPIKE averages (-20 + 0.5 + 0.5) / 3 = -6.3; capped, (-3 + 1) / 3.
    expect(COMPOSITE_CAP).toBe(3)
    expect(out.find(c => c.facilityId === 'SPIKE')!.score).toBeCloseTo(-2 / 3, 10)
    expect(out.find(c => c.facilityId === 'SPIKE')!.nationalRank).toBeLessThan(out.find(c => c.facilityId === 'STEADY_BAD')!.nationalRank)
  })
})
