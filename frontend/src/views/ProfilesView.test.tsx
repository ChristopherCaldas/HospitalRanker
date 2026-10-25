import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { HospitalDetail, ProfileExtras } from '../types'
import { FEATURED, titleCase } from '../lib/profiles'
import { ProfileReport } from './ProfilesView'

describe('titleCase', () => {
  it('makes CMS names readable', () => {
    expect(titleCase('ST FRANCIS HOSPITAL - THE HEART CENTER')).toBe('St Francis Hospital - The Heart Center')
    expect(titleCase("MOUNT ST. MARY'S HOSPITAL & HEALTH CENTER")).toBe("Mount St. Mary's Hospital & Health Center")
    expect(titleCase('CHSLI ST JOSEPH HOSPITAL')).toBe('CHSLI St Joseph Hospital')
    expect(titleCase('HOSPITAL OF UNIV OF PENNSYLVANIA')).toBe('Hospital of Univ of Pennsylvania')
    expect(titleCase('MEDSTAR WASHINGTON HOSPITAL CENTER')).toBe('MedStar Washington Hospital Center')
  })

  it('features each hospital once', () => {
    const ids = FEATURED.flatMap(f => f.ids)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

const scope = (score: number, verdict: 'better' | 'as_expected' | 'worse' = 'as_expected') =>
  ({ measures: 5, groups: 1, score, scoreSe: 0.1, verdict, nationalRank: 100, nationalCount: 3000 })

const hospital = {
  id: '080001', name: 'CHRISTIANA HOSPITAL', city: 'NEWARK', state: 'DE', hospitalType: 'Acute Care Hospitals',
  overallRating: 4, ownership: 'Voluntary non-profit - Private', measures: [], history: {}, notes: [],
  usNewsHonorRoll: false, finance: null, context: null,
  performance: {
    measures: [],
    overall: { measures: 32, score: -0.27, scoreSe: 0.13, verdict: 'as_expected', nationalRank: 2863, stateRank: 3, nationalCount: 3801, stateCount: 7 },
    scopes: { outcome: scope(-0.22), process: scope(-0.76), mortality: scope(-0.2), readmission: scope(0.26), timely_effective: scope(-1.21, 'worse') },
    allMeasures: [
      { measureId: 'SEP_1', name: 'Appropriate care for severe sepsis and septic shock', category: null, group: 'timely_effective', domain: 'process', unit: 'percent', higherIsBetter: true, actual: 39, expected: 62, gapSd: -1.65, verdict: 'worse' },
      { measureId: 'READM_30_CABG', name: '30-day bypass surgery (CABG) readmission rate', category: null, group: 'readmission', domain: 'outcome', unit: 'percent', higherIsBetter: false, actual: 9, expected: 10.6, gapSd: 1.19, verdict: 'as_expected' },
    ],
    peer: null,
  },
} as unknown as HospitalDetail

const extras: ProfileExtras = {
  system: { name: 'ChristianaCare', hospitals: [{ id: '080001', name: 'CHRISTIANA HOSPITAL', city: 'NEWARK', state: 'DE' }] },
  mspb: { value: 1.02, nationalMedian: 0.99, stateMedian: 1.01, windowStart: '2024-01-01', windowEnd: '2024-12-31' },
  cost: { costPerCase: null, salaryPerFte: null, nationalCostPerCase: null, nationalSalaryPerFte: null },
  stateRanks: { outcome: { stateRank: 4, stateCount: 6 } },
}

describe('ProfileReport', () => {
  const html = renderToStaticMarkup(<ProfileReport h={hospital} x={extras} />)

  it('summarizes the hospital from its data', () => {
    expect(html).toContain('Christiana Hospital is <strong>within the normal range</strong>')
    expect(html).toContain('bottom 25%')
    expect(html).toContain('Its outcomes (−0.22) are stronger than its process (−0.76)')
    expect(html).toContain('Strongest area: <strong>readmission</strong>')
    expect(html).toContain('Weakest: <strong>timely &amp; effective</strong>')
  })

  it('lists strengths and weaknesses with actual vs expected', () => {
    expect(html).toContain('Appropriate care for severe sepsis and septic shock')
    expect(html).toContain('39.0% vs. 62.0% expected')
    expect(html).toContain('#4 of 6 in DE')
  })
})
