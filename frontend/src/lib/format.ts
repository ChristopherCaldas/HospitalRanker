import type { Category, Factor, StateRow } from '../types'

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'wait_times',   label: '⏱️ Wait Times' },
  { id: 'mortality',    label: '💀 Mortality' },
  { id: 'safety',       label: '🩺 Patient Safety' },
  { id: 'satisfaction', label: '😊 Satisfaction' },
  { id: 'readmission',  label: '🔄 Readmissions' },
]

// `noun` is the phrase used mid-sentence in findings.
export const FACTORS: { id: Factor; label: string; short: string; noun: string; unit: string; key: keyof StateRow }[] = [
  { id: 'inpatient_occupancy', label: 'Inpatient bed occupancy', short: 'Bed occupancy', noun: 'bed occupancy', unit: 'percent', key: 'inpatientOccupancy' },
  { id: 'icu_occupancy', label: 'ICU bed occupancy', short: 'ICU occupancy', noun: 'ICU occupancy', unit: 'percent', key: 'icuOccupancy' },
  { id: 'resp_admissions_per_100_beds', label: 'COVID + flu admissions per 100 beds per week', short: 'Resp. admissions', noun: 'COVID and flu admissions', unit: 'per100', key: 'respAdmissionsPer100Beds' },
  { id: 'stdzd_spend_pc', label: 'Medicare spend per beneficiary (price-standardized)', short: 'Medicare spend', noun: 'Medicare spending', unit: 'dollars', key: 'stdzdSpendPc' },
  { id: 'ip_stdzd_spend_pc', label: 'Inpatient Medicare spend per beneficiary (price-standardized)', short: 'Inpatient spend', noun: 'inpatient Medicare spending', unit: 'dollars', key: 'ipStdzdSpendPc' },
]

// 'YYYY-MM-DD' -> 'Jul 2022'; parsed as UTC so the month never shifts.
export function formatMonth(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

// Formats a value in a measure's or factor's unit.
export function formatValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  switch (unit) {
    case 'minutes': return `${Math.round(value)} min`
    case 'percent': return `${value.toFixed(1)}%`
    case 'ratio': return value.toFixed(2)
    case 'stars': return `${value.toFixed(value % 1 === 0 ? 0 : 2)}★`
    case 'dollars': return `$${Math.round(value).toLocaleString('en-US')}`
    case 'per100': return value.toFixed(2)
    default: return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }
}

export function formatPercentile(p: number | null): string {
  if (p === null) return '—'
  const n = Math.round(p * 100)
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}

// CMS's own statistical comparison, shortened for table cells.
export function shortComparison(value: string | null): { label: string; tone: 'better' | 'same' | 'worse' } | null {
  if (!value) return null
  if (value.startsWith('Better')) return { label: 'Better than national', tone: 'better' }
  if (value.startsWith('Worse')) return { label: 'Worse than national', tone: 'worse' }
  if (value.startsWith('No Different')) return { label: 'No different', tone: 'same' }
  return null
}
