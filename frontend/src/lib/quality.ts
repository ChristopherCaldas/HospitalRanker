import type { ChainTest, MoneyMetric, QualityGroup, Scope } from '../types'

// Labels for the group/domain scores, the Donabedian chain tests and the
// equity and value analyses.

export const SCOPE_INFO: Record<Scope, { label: string; help: string }> = {
  overall: { label: 'Overall', help: 'All five measure groups, weighted as CMS weights its star rating: 22% each for mortality, safety, readmission and patient experience, 12% for timely and effective care.' },
  outcome: { label: 'Outcomes', help: "What happened to patients: deaths, complications and infections, readmissions, and patients' overall rating of the hospital." },
  process: { label: 'Process', help: "The care itself: timely and effective care (ER waits, sepsis and stroke care) and patients' reports of communication, cleanliness and quiet." },
  mortality: { label: 'Mortality', help: 'Deaths within 30 days for heart attack, heart failure, pneumonia, COPD, stroke and bypass surgery.' },
  safety: { label: 'Safety', help: 'Preventable complications (PSI 90), hip/knee replacement complications and six hospital-acquired infections.' },
  readmission: { label: 'Readmission', help: 'Patients back in the hospital within 30 days, for six conditions and procedures.' },
  experience: { label: 'Patient experience', help: 'Eight patient-survey star ratings: nurse and doctor communication, medicines, discharge information, cleanliness, quiet, overall rating and recommending.' },
  timely_effective: { label: 'Timely & effective', help: 'ER waits, patients leaving before being seen, sepsis care, head CTs for stroke and staff flu vaccination.' },
}

export const GROUPS: QualityGroup[] = ['mortality', 'safety', 'readmission', 'experience', 'timely_effective']

// Chain variables: structure (cost reports) and the score each test reads.
export const CHAIN_LABELS: Record<string, string> = {
  fte_per_bed: 'Staff per bed',
  salary_per_fte: 'Average pay per employee',
  contract_labor: 'Reliance on agency staff',
  cost_per_discharge: 'Spending per patient',
  fixed_assets_per_bed: 'Buildings and equipment per bed',
  investments_per_bed: 'Investments per bed',
  patient_margin: 'Margin on patient care',
  total_margin: 'Overall margin',
  beds: 'Size (beds)',
  in_system: 'Part of a health system',
  process: 'Process score',
  timely_effective: 'Timely & effective care (no surveys)',
  clinical_outcome: 'Clinical outcomes',
  mortality: 'Mortality',
  safety: 'Safety',
  readmission: 'Readmission',
  SEP_1: 'Sepsis care',
  MORT_30_PN: 'Pneumonia deaths',
  OP_23: 'Fast head CT for stroke',
  MORT_30_STK: 'Stroke deaths',
  OP_18b: 'ER time before admission',
  H_COMP_6_STAR_RATING: 'Discharge information',
  H_COMP_5_STAR_RATING: 'Explaining medicines',
  H_COMP_1_STAR_RATING: 'Nurse communication',
}

export const chainLabel = (key: string) => CHAIN_LABELS[key] ?? key

// How to say "more" and "less" of each structure variable.
const STRUCTURE_PHRASES: Record<string, [string, string]> = {
  fte_per_bed: ['more staff per bed', 'fewer staff per bed'],
  salary_per_fte: ['higher pay', 'lower pay'],
  contract_labor: ['more agency staff', 'less agency staff'],
  cost_per_discharge: ['more spending per patient', 'less spending per patient'],
  fixed_assets_per_bed: ['more buildings and equipment per bed', 'less buildings and equipment per bed'],
  investments_per_bed: ['more investments per bed', 'fewer investments per bed'],
  patient_margin: ['higher margins on patient care', 'lower margins on patient care'],
  total_margin: ['higher overall margins', 'lower overall margins'],
  beds: ['more beds', 'fewer beds'],
  in_system: ['belonging to a health system', 'being independent'],
}

export const structurePhrase = (key: string, r: number) => STRUCTURE_PHRASES[key]?.[r >= 0 ? 0 : 1] ?? chainLabel(key)

// Why each clinical pair might be linked.
export const PAIR_REASONS: Record<string, string> = {
  'SEP_1 mortality': 'Sepsis is a leading cause of hospital deaths, and the bundle is meant to prevent them.',
  'SEP_1 MORT_30_PN': 'Many pneumonia deaths involve sepsis.',
  'OP_23 MORT_30_STK': 'Stroke treatment is time-critical, and a fast scan comes first.',
  'OP_18b mortality': 'Long ER boarding has been linked to worse outcomes.',
  'H_COMP_6_STAR_RATING readmission': 'Patients who understand their discharge plan should need fewer return trips.',
  'H_COMP_5_STAR_RATING readmission': 'Medication mix-ups are a common reason patients come back.',
  'H_COMP_1_STAR_RATING safety': 'Nurses who communicate well may catch problems earlier.',
}

// Reading a correlation in words. Thresholds follow common practice for
// hospital-level associations.
export function strengthOf(r: number | null): string {
  const a = Math.abs(r ?? 0)
  if (a < 0.1) return 'no meaningful'
  if (a < 0.2) return 'a weak'
  if (a < 0.4) return 'a modest'
  return 'a clear'
}

export const isSignificant = (t: ChainTest) => t.qValue !== null && t.qValue < 0.05

export const MONEY_LABELS: Record<MoneyMetric, { label: string; format: 'pct' | 'usd' | 'number' }> = {
  total_margin: { label: 'Overall margin', format: 'pct' },
  patient_margin: { label: 'Margin on patient care', format: 'pct' },
  uncompensated: { label: 'Uncompensated care (share of costs)', format: 'pct' },
  other_income: { label: 'Other income (share of patient revenue)', format: 'pct' },
  cost_per_discharge: { label: 'Spending per patient', format: 'usd' },
  fte_per_bed: { label: 'Staff per bed', format: 'number' },
  salary_per_fte: { label: 'Average pay per employee', format: 'usd' },
  contract_labor: { label: 'Agency staff (share of salaries)', format: 'pct' },
}

export function formatMoney(value: number | null, format: 'pct' | 'usd' | 'number'): string {
  if (value === null) return '—'
  if (format === 'pct') return `${(value * 100).toFixed(1)}%`
  if (format === 'usd') return `$${Math.round(value).toLocaleString('en-US')}`
  return value.toFixed(1)
}

export const FIFTH_LABELS = ['Fewest low-income patients', 'Second', 'Middle', 'Fourth', 'Most low-income patients']

export const pctRange = (lo: number, hi: number) => `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`
