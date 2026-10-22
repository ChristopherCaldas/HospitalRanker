// Labels for the movers analysis (backend/src/analysis/movers.ts).

export const MOVER_LABELS: Record<'improved' | 'declined', { label: string; className: string }> = {
  improved: { label: 'Clearly improved', className: 'bg-green-50 text-green-800 border-green-200' },
  declined: { label: 'Clearly declined', className: 'bg-red-50 text-red-800 border-red-200' },
}

export const CHANGE_GROUP_INFO: Record<string, { name: string; description: string }> = {
  peer_group: { name: 'Hospital type and ownership', description: 'critical access, VA, for-profit, government-run' },
  size_at_start: { name: 'Size at the start', description: 'beds and inpatients a year' },
  finances_at_start: { name: 'Finances at the start', description: 'margins, unpaid care, Medicaid days' },
  staffing_at_start: { name: 'Staffing at the start', description: 'agency staff, staff per bed, occupancy, pay' },
  size_change: { name: 'Growing or shrinking', description: 'change in beds and inpatients a year' },
  finance_change: { name: 'Change in finances', description: 'margins improving or falling, more or less unpaid care' },
  staffing_change: { name: 'Change in staffing', description: 'more or less agency staff, staff per bed, occupancy, pay' },
  ownership_change: { name: 'Change of ownership', description: 'CMS recorded a sale or merger between the two periods' },
}

// A change in the measure's own units, oriented: "+12 min better".
export function formatChange(value: number, unit: string): string {
  const v = Math.abs(value)
  const amount = unit === 'minutes' ? `${Math.round(v)} min` : unit === 'percent' ? `${v.toFixed(1)} pts` : unit === 'stars' ? `${v.toFixed(1)}★` : v.toFixed(2)
  return `${amount} ${value >= 0 ? 'better' : 'worse'}`
}
