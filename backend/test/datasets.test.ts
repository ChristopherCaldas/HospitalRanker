import { describe, expect, it } from 'vitest'
import { MEASURE_DATASETS } from '../src/ingest/datasets'

// Rows shaped like the real CMS CSV headers and values.
const base = { 'Facility ID': ' 010001 ', 'Facility Name': 'SOUTHEAST HEALTH MEDICAL CENTER', 'Start Date': '07/01/2022', 'End Date': '06/30/2025' }

describe('CMS CSV mappings', () => {
  it('reads Timely and Effective Care rows (sample as the denominator)', () => {
    const row = { ...base, 'Measure ID': 'OP_18b', Score: '212', Sample: '396', Footnote: '' }
    expect(MEASURE_DATASETS['yv7e-xc69'].toScore(row)).toEqual({
      facility_id: '010001', measure_id: 'OP_18b', score: 212, lower_estimate: null, higher_estimate: null,
      denominator: 396, compared_to_national: null, footnote: null, start_date: '2022-07-01', end_date: '2025-06-30',
    })
  })

  it('reads Complications and Deaths rows with intervals and the national comparison', () => {
    const row = {
      ...base, 'Measure ID': 'PSI_90', Score: '0.95', Denominator: 'Not Applicable', 'Lower Estimate': '0.66',
      'Higher Estimate': '1.25', 'Compared to National': 'No Different Than the National Value', Footnote: '',
    }
    const score = MEASURE_DATASETS['ynj2-r877'].toScore(row)
    expect(score).toMatchObject({ score: 0.95, lower_estimate: 0.66, higher_estimate: 1.25, denominator: null })
    expect(score.compared_to_national).toBe('No Different Than the National Value')
  })

  it('keeps suppressed scores as null with their footnote', () => {
    const row = {
      ...base, 'Measure ID': 'Hybrid_HWR', Score: 'Not Available', Denominator: 'Not Available', 'Lower Estimate': 'Not Available',
      'Higher Estimate': 'Not Available', 'Compared to National': 'Not Available', Footnote: '4',
    }
    expect(MEASURE_DATASETS['632h-zaca'].toScore(row)).toMatchObject({ score: null, footnote: '4', compared_to_national: null })
  })

  it('reads HCAHPS from its own column names', () => {
    const row = {
      ...base, 'HCAHPS Measure ID': 'H_COMP_1_STAR_RATING', 'Patient Survey Star Rating': '3',
      'Patient Survey Star Rating Footnote': '', 'Number of Completed Surveys': '1392',
    }
    expect(MEASURE_DATASETS['dgck-syfz'].measureIdColumn).toBe('HCAHPS Measure ID')
    expect(MEASURE_DATASETS['dgck-syfz'].toScore(row)).toMatchObject({ measure_id: 'H_COMP_1_STAR_RATING', score: 3, denominator: 1392 })
  })
})
