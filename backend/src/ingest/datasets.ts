import { toDate, toInt, toNumber, toText } from './parse'

export type CsvRow = Record<string, string>

export interface ScoreRow {
  facility_id: string
  measure_id: string
  score: number | null
  lower_estimate: number | null
  higher_estimate: number | null
  denominator: number | null
  compared_to_national: string | null
  footnote: string | null
  start_date: string | null
  end_date: string | null
}

// The general-information dataset populates `hospitals`.
export const HOSPITAL_INFO_DATASET = 'xubh-q36u'

export interface DatasetSpec {
  measureIdColumn: string
  toScore: (r: CsvRow) => ScoreRow
  // For datasets that spread one score over several rows: which measure a
  // row belongs to, and how to fold a measure's rows into scores.
  measureOf?: (rowMeasureId: string) => string
  toScores?: (rows: CsvRow[]) => ScoreRow[]
}

// How to read a score row out of each measure dataset's CSV. Column headers
// differ between datasets (HCAHPS especially), so each gets its own mapping.
export const MEASURE_DATASETS: Record<string, DatasetSpec> = {
  // Timely and Effective Care
  'yv7e-xc69': {
    measureIdColumn: 'Measure ID',
    toScore: r => ({
      ...common(r, 'Measure ID'),
      score: toNumber(r['Score']),
      lower_estimate: null,
      higher_estimate: null,
      denominator: toInt(r['Sample']),
      compared_to_national: null,
      footnote: toText(r['Footnote']),
    }),
  },
  // Complications and Deaths
  'ynj2-r877': {
    measureIdColumn: 'Measure ID',
    toScore: r => withEstimates(r),
  },
  // Unplanned Hospital Visits
  '632h-zaca': {
    measureIdColumn: 'Measure ID',
    toScore: r => withEstimates(r),
  },
  // Patient survey (HCAHPS)
  'dgck-syfz': {
    measureIdColumn: 'HCAHPS Measure ID',
    toScore: r => ({
      ...common(r, 'HCAHPS Measure ID'),
      score: toNumber(r['Patient Survey Star Rating']),
      lower_estimate: null,
      higher_estimate: null,
      denominator: toInt(r['Number of Completed Surveys']),
      compared_to_national: null,
      footnote: toText(r['Patient Survey Star Rating Footnote']),
    }),
  },
  // Healthcare Associated Infections: each infection is a SIR row plus rows for
  // its CI bounds, predicted and observed cases and exposure (HAI_1_CILOWER ...).
  '77hc-ibv8': {
    measureIdColumn: 'Measure ID',
    toScore: r => ({
      ...common(r, 'Measure ID'),
      score: toNumber(r['Score']),
      lower_estimate: null,
      higher_estimate: null,
      denominator: null,
      compared_to_national: toText(r['Compared to National']),
      footnote: toText(r['Footnote']),
    }),
    measureOf: id => id.replace(/_(CILOWER|CIUPPER|ELIGCASES|NUMERATOR|DOPC)$/, '_SIR'),
    toScores: foldInfections,
  },
  // Medicare Spending Per Beneficiary
  'rrqw-56er': {
    measureIdColumn: 'Measure ID',
    toScore: r => ({
      ...common(r, 'Measure ID'),
      score: toNumber(r['Score']),
      lower_estimate: null,
      higher_estimate: null,
      denominator: null,
      compared_to_national: null,
      footnote: toText(r['Footnote']),
    }),
  },
}

// The row a measure's id maps to, for filtering CSV rows.
export const rowMeasure = (spec: DatasetSpec, row: CsvRow): string => {
  const id = row[spec.measureIdColumn]?.trim() ?? ''
  return spec.measureOf ? spec.measureOf(id) : id
}

export const toScores = (spec: DatasetSpec, rows: CsvRow[]): ScoreRow[] =>
  spec.toScores ? spec.toScores(rows) : rows.map(spec.toScore)

// One score per hospital x infection: the SIR with its 95% interval, and the
// predicted case count (rounded) as the denominator, since a SIR's sampling
// variance is about SIR / predicted cases.
export function foldInfections(rows: CsvRow[]): ScoreRow[] {
  const parts = new Map<string, Map<string, CsvRow>>()
  for (const r of rows) {
    const [, base, part] = /^(HAI_\d+)_(\w+)$/.exec(r['Measure ID'].trim()) ?? []
    if (!base) continue
    const key = `${r['Facility ID'].trim()} ${base}`
    if (!parts.has(key)) parts.set(key, new Map())
    parts.get(key)!.set(part, r)
  }
  const out: ScoreRow[] = []
  for (const byPart of parts.values()) {
    const sir = byPart.get('SIR')
    if (!sir) continue
    const value = (part: string) => toNumber(byPart.get(part)?.['Score'] ?? '')
    const predicted = value('ELIGCASES')
    out.push({
      ...MEASURE_DATASETS['77hc-ibv8'].toScore(sir),
      lower_estimate: value('CILOWER'),
      higher_estimate: value('CIUPPER'),
      denominator: predicted === null ? null : Math.round(predicted),
    })
  }
  return out
}

function common(r: CsvRow, measureIdColumn: string) {
  return {
    facility_id: r['Facility ID'].trim(),
    measure_id: r[measureIdColumn].trim(),
    start_date: toDate(r['Start Date']),
    end_date: toDate(r['End Date']),
  }
}

function withEstimates(r: CsvRow): ScoreRow {
  return {
    ...common(r, 'Measure ID'),
    score: toNumber(r['Score']),
    lower_estimate: toNumber(r['Lower Estimate']),
    higher_estimate: toNumber(r['Higher Estimate']),
    denominator: toInt(r['Denominator']),
    compared_to_national: toText(r['Compared to National']),
    footnote: toText(r['Footnote']),
  }
}
