import type { Verdict } from '../types'

// Plain-language labels for the expected-performance model's predictors and
// predictor groups (backend/src/analysis/expected.ts).

export const PREDICTOR_LABELS: Record<string, string> = {
  critical_access: 'Critical access hospital (small rural), vs. a regular acute care hospital',
  federal: 'VA or military hospital',
  other_type: "Other hospital type (children's, psychiatric, etc.)",
  for_profit: 'For-profit, vs. non-profit',
  public: 'Government-run (state, local or tribal), vs. non-profit',
  physician_owned: 'Physician-owned, vs. non-profit',
  occupancy_per_10pt: "10 points more of the state's hospital beds in use",
  medicare_spend_per_1k: '$1,000 more Medicare spending per person in the state',
  low_income_per_10pt: "10 points more of the state's Medicare patients on Medicaid too (low income)",
  dual_eligible_per_10pt: "10 points more of the hospital's own Medicare patients also on Medicaid",
  low_income_patients_per_10pt: '10 points more low-income patient days (CMS disproportionate-share percentage)',
  case_mix_per_0_25: 'Case mix 0.25 higher (more complex inpatients)',
  residents_per_bed_per_0_1: '0.1 more doctors in training per bed (teaching intensity)',
  county_vulnerability_per_10pt: "County 10 percentiles higher on CDC's social vulnerability index",
  county_poverty_per_10pt: '10 points more county residents near poverty',
  county_uninsured_per_5pt: '5 points more county residents uninsured',
  rural: 'Rural, vs. urban',
}

export const GROUP_LABELS: Record<string, { name: string; description: string }> = {
  peer_group: { name: 'Hospital type and ownership', description: 'critical access vs. acute care, VA, for-profit, government-run' },
  patients: { name: "The hospital's patients", description: 'its share of low-income patients (dual-eligible and disproportionate-share)' },
  complexity: { name: 'How complex its care is', description: 'case mix and teaching intensity (ER times and patient ratings only)' },
  community: { name: 'Its community', description: "its county's social vulnerability, poverty and uninsured rates; rural or urban" },
  crowding: { name: 'How full hospitals were', description: "the state's bed occupancy over the period" },
  spending: { name: 'Medicare spending', description: 'price-adjusted spending per person in the state' },
  low_income: { name: 'Low-income share', description: "share of the state's Medicare patients also on Medicaid" },
}

export const VERDICT_LABELS: Record<Verdict, { label: string; className: string }> = {
  better: { label: 'Clearly better than expected', className: 'bg-green-50 text-green-800 border-green-200' },
  as_expected: { label: 'About as expected', className: 'bg-gray-50 text-gray-600 border-gray-200' },
  worse: { label: 'Clearly worse than expected', className: 'bg-red-50 text-red-800 border-red-200' },
}

// How much adjusting for context reshuffles a ranking, from the Spearman
// correlation between raw and adjusted orders.
export function reshuffle(rankAgreement: number): string {
  if (rankAgreement >= 0.9) return 'Barely changes'
  if (rankAgreement >= 0.8) return 'Some changes'
  return 'Noticeable reshuffle'
}

// Composite scores are in units of the typical real difference between
// hospitals ("standard deviations").
export function formatScore(score: number): string {
  return `${score >= 0 ? '+' : '−'}${Math.abs(score).toFixed(2)}`
}

export const NOTE_KINDS: Record<'news' | 'recognition' | 'rating', string> = {
  news: 'News',
  recognition: 'Ranking or award',
  rating: 'Rating',
}

interface Driver {
  category: string
  actual: number
  expected: number
  gapSd: number
}

// What puts a hospital near the top (direction +1) or bottom (-1): its measures
// furthest from expected in that direction (at least 1 typical spread, up to
// 3), plus its strongest measure the other way, if notable.
export function drivers<T extends Driver>(measures: T[], direction: 1 | -1): { main: T[]; counter: T | null } {
  const sorted = [...measures].sort((a, b) => direction * (b.gapSd - a.gapSd))
  const strong = sorted.filter(m => direction * m.gapSd >= 1).slice(0, 3)
  const main = strong.length ? strong : sorted.slice(0, 1)
  const other = sorted[sorted.length - 1]
  const counter = other && !main.includes(other) && -direction * other.gapSd >= 1 ? other : null
  return { main, counter }
}
