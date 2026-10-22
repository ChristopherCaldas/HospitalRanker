// Plain-language labels for the predictor search (backend/src/analysis/predictors.ts).

// `more` completes "Hospitals with ..." for the direction sentences.
export const VARIABLE_LABELS: Record<string, { label: string; more: string }> = {
  state_crowding: { label: "State's hospital bed occupancy", more: 'fuller hospitals statewide' },
  state_respiratory: { label: 'State COVID and flu admissions', more: 'more COVID and flu admissions statewide' },
  state_spending: { label: 'State Medicare spending per person', more: 'more Medicare spending per person statewide' },
  state_low_income: { label: "State's low-income Medicare share", more: 'a poorer state Medicare population' },
  patient_margin: { label: 'Profit margin on patient care', more: 'a bigger profit margin on patient care' },
  total_margin: { label: 'Overall profit margin', more: 'a bigger overall profit margin' },
  dual: { label: 'Dual-eligible patients', more: 'more patients on both Medicare and Medicaid' },
  dsh: { label: 'Low-income patient days', more: 'more low-income patient days' },
  medicaid_days: { label: 'Medicaid share of days', more: 'more Medicaid patient days' },
  svi: { label: 'County social vulnerability', more: 'a more socially vulnerable county' },
  poverty: { label: 'County poverty', more: 'more poverty in their county' },
  uninsured: { label: 'County uninsured rate', more: 'more uninsured residents in their county' },
  rural: { label: 'Rural', more: 'a rural location' },
  case_mix: { label: 'Case mix', more: 'more complex inpatients' },
  teaching: { label: 'Teaching intensity', more: 'more doctors in training per bed' },
  beds: { label: 'Beds', more: 'more beds' },
  discharges: { label: 'Patients discharged per year', more: 'more inpatients a year' },
  cases: { label: 'Cases behind the score', more: 'more cases behind the score' },
  in_system: { label: 'Part of a health system', more: 'membership in a health system' },
  system_size: { label: 'Health-system size', more: 'a bigger parent health system' },
  other_income: { label: 'Other income (donations, grants, investments)', more: 'more income from outside patient care' },
  uncompensated: { label: 'Uncompensated care', more: 'more unpaid care' },
  cost_per_discharge: { label: 'Cost per inpatient', more: 'higher costs per inpatient' },
  salary_per_fte: { label: 'Average pay per employee', more: 'higher average pay' },
  investments_per_bed: { label: 'Investments per bed', more: 'more investments per bed' },
  fixed_assets_per_bed: { label: 'Buildings and equipment per bed', more: 'more buildings and equipment per bed' },
  debt_ratio: { label: 'Debt (liabilities ÷ assets)', more: 'more debt' },
  current_ratio: { label: 'Short-term cushion (current ratio)', more: 'a bigger short-term cash cushion' },
  fte_per_bed: { label: 'Staff per bed', more: 'more staff per bed' },
  contract_labor: { label: 'Agency (contract) staff', more: 'more agency staff' },
  occupancy: { label: 'Own bed occupancy', more: 'fuller beds' },
  prior_score: { label: 'Its own earlier score', more: 'better earlier scores' },
}

export const GROUP_INFO: Record<string, { name: string; description: string }> = {
  state: { name: 'State conditions', description: "the state's bed occupancy, COVID and flu load, Medicare spending and low-income share" },
  profit: { name: 'Profit margins', description: 'margin on patient care and overall margin' },
  peer_group: { name: 'Hospital type and ownership', description: 'critical access, VA, for-profit, government-run, physician-owned' },
  patients: { name: "Patients' incomes", description: 'dual-eligible share, low-income days, Medicaid days' },
  community: { name: 'Community', description: "county social vulnerability, poverty, uninsured rate; rural or not" },
  complexity: { name: 'Complexity and teaching', description: 'case mix index and doctors in training per bed' },
  size: { name: 'Size and volume', description: 'beds, inpatients a year, cases behind the score' },
  system: { name: 'Health-system membership', description: 'part of a system or not, and how big the system is' },
  finances: { name: 'Balance sheet and costs', description: 'other income, unpaid care, cost per inpatient, pay, investments, buildings, debt, cash cushion' },
  staffing: { name: 'Staffing and occupancy', description: 'staff per bed, agency staff, how full its beds are' },
  track_record: { name: 'Its own past score', description: 'the same measure from an earlier, non-overlapping period' },
}

// The original hypotheses, in the order the page lists them.
export const ASSUMPTIONS = ['state_crowding', 'state_respiratory', 'state_spending', 'state_low_income', 'patient_margin', 'total_margin']

export const MODEL_STEPS: { key: 'assumptions' | 'fair_context' | 'everything_known' | 'with_track_record'; label: string; help: string }[] = [
  { key: 'assumptions', label: 'What we first assumed', help: 'state conditions and profit margins' },
  { key: 'fair_context', label: 'Fair context', help: 'what the expected scores adjust for: type, patients, community, complexity, state' },
  { key: 'everything_known', label: 'Every hospital fact we have', help: 'plus size, health system, finances and staffing' },
  { key: 'with_track_record', label: '…plus its own past score', help: 'the same measure from an earlier period' },
]

export const share = (v: number) => `${Math.max(0, Math.round(v * 100))}%`

// Words for a correlation's size, for sentences.
export function strengthOf(r: number): string {
  const a = Math.abs(r)
  if (a < 0.1) return 'no real'
  if (a < 0.3) return 'a weak'
  if (a < 0.5) return 'a moderate'
  return 'a strong'
}

export const formatR = (r: number) => `${r < 0 ? '−' : ''}${Math.abs(r).toFixed(2)}`
