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
}

export const GROUP_LABELS: Record<string, { name: string; description: string }> = {
  peer_group: { name: 'Hospital type and ownership', description: 'critical access vs. acute care, VA, for-profit, government-run' },
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
