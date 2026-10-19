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

// How to read a score row out of each measure dataset's CSV. Column headers
// differ between datasets (HCAHPS especially), so each gets its own mapping.
export const MEASURE_DATASETS: Record<string, { measureIdColumn: string; toScore: (r: CsvRow) => ScoreRow }> = {
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
