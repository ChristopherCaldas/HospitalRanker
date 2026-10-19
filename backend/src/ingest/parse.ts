// CMS CSVs use sentinel strings rather than empty cells for missing values.
const MISSING = new Set(['', 'Not Available', 'Not Applicable', 'N/A'])

export function toNumber(value: string | undefined): number | null {
  if (value === undefined || MISSING.has(value.trim())) return null
  const n = Number(value.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export function toInt(value: string | undefined): number | null {
  const n = toNumber(value)
  return n === null ? null : Math.round(n)
}

export function toText(value: string | undefined): string | null {
  if (value === undefined || MISSING.has(value.trim())) return null
  return value.trim()
}

// 'MM/DD/YYYY' -> 'YYYY-MM-DD'
export function toDate(value: string | undefined): string | null {
  const m = value?.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null
}

// CDC NHSN reporting mandate boundaries, per the dataset description.
export function reportingPeriod(weekEnding: string): string {
  if (weekEnding < '2024-05-01') return 'mandated_2020'
  if (weekEnding < '2024-11-01') return 'voluntary_2024'
  return 'mandated_2024'
}

export function toBool(value: string | undefined): boolean | null {
  const v = value?.trim().toLowerCase()
  if (v === 'yes' || v === 'y') return true
  if (v === 'no' || v === 'n') return false
  return null
}
