import type { Category, Factor, StateRow } from '../types'

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'wait_times',   label: 'ER Wait Times' },
  { id: 'mortality',    label: 'Mortality' },
  { id: 'safety',       label: 'Patient Safety' },
  { id: 'satisfaction', label: 'Satisfaction' },
  { id: 'readmission',  label: 'Readmissions' },
]

// Plain-language meaning of each category's score, for readers without a
// healthcare-data background. `caseNoun` says what the "cases" count is;
// null when CMS publishes no case counts for the measure.
export const MEASURE_GUIDE: Record<Category, { score: string; caseNoun: string | null; example: string }> = {
  wait_times: {
    score: 'The median number of minutes patients spent in the emergency room, from arrival until they left. Patients sent on to another hospital and psychiatric patients are left out.',
    caseNoun: 'ER visits sampled',
    example: '150 min means half of patients were out within two and a half hours.',
  },
  mortality: {
    score: "The share of Medicare heart attack patients who died, from any cause, within 30 days of arriving. CMS adjusts it for how sick each hospital's patients were, so hospitals treating sicker patients aren't penalized for it.",
    caseNoun: 'heart attack patients',
    example: '12% means roughly 12 in 100 patients died within a month.',
  },
  safety: {
    score: "How often serious, potentially avoidable complications happened (such as bedsores, injuries during surgery, or infections after surgery) compared with what CMS would expect for that hospital's patients.",
    caseNoun: null,
    example: '1.00 is exactly as expected. 0.80 is 20% fewer complications than expected; 1.25 is 25% more.',
  },
  satisfaction: {
    score: 'A 1–5 star rating for how well nurses communicated, built from patient surveys: did nurses listen, explain things clearly, and treat patients with courtesy and respect?',
    caseNoun: 'surveys completed',
    example: '5★ is the top rating; most hospitals get 3★ or 4★.',
  },
  readmission: {
    score: "The share of Medicare heart failure patients who ended up back in a hospital unexpectedly within 30 days of going home. CMS adjusts it for how sick the patients were.",
    caseNoun: 'heart failure patients',
    example: '21% means about 1 in 5 patients were back within a month.',
  },
}

// `noun` is the phrase used mid-sentence in findings; `description` explains
// the factor to a first-time reader.
export const FACTORS: { id: Factor; label: string; short: string; noun: string; description: string; unit: string; key: keyof StateRow }[] = [
  {
    id: 'inpatient_occupancy', label: 'Hospital beds in use', short: 'Bed occupancy', noun: 'bed occupancy', unit: 'percent', key: 'inpatientOccupancy',
    description: "The share of a state's staffed hospital beds that were filled, averaged over the weeks the scores cover. A rough gauge of how stretched hospitals were. Source: CDC.",
  },
  {
    id: 'icu_occupancy', label: 'ICU beds in use', short: 'ICU occupancy', noun: 'ICU occupancy', unit: 'percent', key: 'icuOccupancy',
    description: 'The same idea for intensive-care beds, where shortages tend to hit hardest. Source: CDC.',
  },
  {
    id: 'resp_admissions_per_100_beds', label: 'Weekly COVID + flu admissions per 100 beds', short: 'COVID + flu load', noun: 'COVID and flu admissions', unit: 'per100', key: 'respAdmissionsPer100Beds',
    description: 'New COVID and flu hospital admissions each week, scaled to the number of beds so big and small states can be compared. Source: CDC.',
  },
  {
    id: 'stdzd_spend_pc', label: 'Medicare spending per person', short: 'Medicare spending', noun: 'Medicare spending', unit: 'dollars', key: 'stdzdSpendPc',
    description: "What traditional Medicare spends per enrolled person per year, with regional price differences (like higher wages in Alaska) taken out, so it reflects how much care people get rather than local prices. Source: CMS.",
  },
  {
    id: 'ip_stdzd_spend_pc', label: 'Medicare hospital-stay spending per person', short: 'Hospital-stay spending', noun: 'Medicare spending on hospital stays', unit: 'dollars', key: 'ipStdzdSpendPc',
    description: 'The part of Medicare spending that goes to inpatient hospital stays, price-adjusted the same way. Source: CMS.',
  },
]

// Conventional words for the size of a correlation coefficient.
export function correlationStrength(r: number | null): string {
  if (r === null) return 'unknown'
  const a = Math.abs(r)
  if (a < 0.1) return 'no real'
  if (a < 0.3) return 'weak'
  if (a < 0.5) return 'moderate'
  return 'strong'
}

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
  if (value.startsWith('No Different')) return { label: 'Same as national', tone: 'same' }
  return null
}

export const COMPARISON_HELP =
  "CMS's own verdict. It tests whether the hospital's score is clearly different from the national rate once the hospital's size and margin of error are taken into account. \"Same as national\" means any difference could be down to chance."

// States and DC plus PR, for state filters.
export const STATES = [
  'AK','AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','HI','IA','ID','IL','IN','KS','KY','LA','MA','MD',
  'ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ','NM','NV','NY','OH','OK','OR','PA','PR','RI','SC',
  'SD','TN','TX','UT','VA','VT','WA','WI','WV','WY',
]
