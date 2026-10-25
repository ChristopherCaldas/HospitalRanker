import { COMPOSITE_CAP, verdictOf, type HospitalResult, type Verdict } from './expected'

// Group, domain and overall scores from the per-measure expected-model gaps.
//
// Structure follows the CMS Overall Star Rating: measures are averaged within
// their group first (so mortality's six conditions count as one group, not
// six votes), then groups are weighted 22% each for mortality, safety,
// readmission and patient experience and 12% for timely and effective care,
// re-weighted over the groups a hospital has. Each measure enters as its gap
// in units of its own tau (one SD of real hospital-to-hospital spread),
// capped at +-COMPOSITE_CAP.
//
// Domains split the same measures along Donabedian's line: outcome (deaths,
// complications and infections, readmissions, overall rating and
// recommending) and process (timely and effective care, patients' reports of
// communication, cleanliness and quiet).
//
// Each measure's gap is already a posterior mean (shrunk by the expected
// model, or by CMS's own model), so a weighted average of them is the
// posterior mean of the weighted true score, with the weighted posterior
// variance; no second shrinkage. By the law of total variance the real spread
// of scores across hospitals is the variance of those means plus their
// average posterior variance; one SD of it is the clear-cases margin.

export type QualityGroup = 'mortality' | 'safety' | 'readmission' | 'experience' | 'timely_effective'
export type Domain = 'process' | 'outcome'

export const GROUP_WEIGHTS: Record<QualityGroup, number> = {
  mortality: 0.22,
  safety: 0.22,
  readmission: 0.22,
  experience: 0.22,
  timely_effective: 0.12,
}

// Survey items come from the same respondents, so their noise is treated as
// fully correlated within the group (averaging them doesn't cancel it). Other
// groups' measures cover different patients and are treated as independent.
const SHARED_SAMPLE = new Set<QualityGroup>(['experience'])

export interface ScoredMeasure {
  measureId: string
  group: QualityGroup
  domain: Domain
  tau: number
  results: HospitalResult[]
}

interface Scope {
  domain?: Domain
  group?: QualityGroup
  minGroups: number
  minMeasures: number
}

// Overall needs three groups, as CMS requires for a star rating. Process has
// only two groups, so it needs both.
export const SCOPES: Record<string, Scope> = {
  overall: { minGroups: 3, minMeasures: 3 },
  outcome: { domain: 'outcome', minGroups: 2, minMeasures: 3 },
  process: { domain: 'process', minGroups: 2, minMeasures: 3 },
  ...Object.fromEntries(
    (Object.keys(GROUP_WEIGHTS) as QualityGroup[]).map(g => [g, { group: g, minGroups: 1, minMeasures: 2 }])
  ),
}

export interface ScopeResult {
  facilityId: string
  state: string
  measures: number
  groups: number
  score: number
  scoreSe: number
  verdict: Verdict
  nationalRank: number
  stateRank: number
}

export function scopeScores(measures: ScoredMeasure[], scope: Scope): ScopeResult[] {
  // facility -> group -> scaled values and SEs
  const byHospital = new Map<string, { state: string; groups: Map<QualityGroup, { v: number[]; se: number[] }> }>()
  for (const m of measures) {
    if (!(m.tau > 0)) continue
    if (scope.domain && m.domain !== scope.domain) continue
    if (scope.group && m.group !== scope.group) continue
    for (const r of m.results) {
      const h = byHospital.get(r.facilityId) ?? { state: r.state, groups: new Map() }
      const g = h.groups.get(m.group) ?? { v: [], se: [] }
      g.v.push(Math.min(COMPOSITE_CAP, Math.max(-COMPOSITE_CAP, r.adjustedGap / m.tau)))
      g.se.push(r.gapSe / m.tau)
      h.groups.set(m.group, g)
      byHospital.set(r.facilityId, h)
    }
  }

  const rows = [...byHospital.entries()].flatMap(([facilityId, h]) => {
    const groups = [...h.groups.entries()]
    const measureCount = groups.reduce((a, [, g]) => a + g.v.length, 0)
    if (groups.length < scope.minGroups || measureCount < scope.minMeasures) return []
    let sumW = 0
    let score = 0
    let variance = 0
    for (const [group, g] of groups) {
      const k = g.v.length
      const mean = g.v.reduce((a, b) => a + b, 0) / k
      const se = SHARED_SAMPLE.has(group)
        ? g.se.reduce((a, b) => a + b, 0) / k
        : Math.sqrt(g.se.reduce((a, s) => a + s * s, 0)) / k
      const w = GROUP_WEIGHTS[group]
      sumW += w
      score += w * mean
      variance += (w * se) ** 2
    }
    return [{ facilityId, state: h.state, measures: measureCount, groups: groups.length, score: score / sumW, scoreSe: Math.sqrt(variance) / sumW }]
  })

  const n = Math.max(1, rows.length)
  const mean = rows.reduce((a, r) => a + r.score, 0) / n
  const spread = rows.reduce((a, r) => a + (r.score - mean) ** 2, 0) / Math.max(1, rows.length - 1)
  const margin = Math.sqrt(spread + rows.reduce((a, r) => a + r.scoreSe ** 2, 0) / n)
  const ranked = [...rows].sort((a, b) => b.score - a.score || a.facilityId.localeCompare(b.facilityId))

  const stateCounts = new Map<string, number>()
  return ranked.map((r, i) => {
    const stateRank = (stateCounts.get(r.state) ?? 0) + 1
    stateCounts.set(r.state, stateRank)
    return {
      facilityId: r.facilityId, state: r.state, measures: r.measures, groups: r.groups,
      score: r.score, scoreSe: r.scoreSe,
      verdict: verdictOf(r.score, r.scoreSe, margin), nationalRank: i + 1, stateRank,
    }
  })
}

export function allScopes(measures: ScoredMeasure[]): Record<string, ScopeResult[]> {
  return Object.fromEntries(Object.entries(SCOPES).map(([name, scope]) => [name, scopeScores(measures, scope)]))
}
