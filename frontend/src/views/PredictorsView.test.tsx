import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Category, MeasurePredictors, PredictorsOverview } from '../types'
import { GROUP_INFO, VARIABLE_LABELS, formatR, strengthOf } from '../lib/predictors'
import { PredictorsReport } from './PredictorsView'

const MEASURES: [string, Category, boolean][] = [
  ['OP_18b', 'wait_times', true],
  ['MORT_30_AMI', 'mortality', false],
  ['PSI_90', 'safety', false],
  ['H_COMP_1_STAR_RATING', 'satisfaction', true],
  ['READM_30_HF', 'readmission', false],
]

function measure([measureId, category, raw]: (typeof MEASURES)[number], i: number): MeasurePredictors {
  return {
    measureId,
    category,
    higherIsBetter: category === 'satisfaction',
    hospitals: 3000 + i,
    groups: Object.fromEntries(Object.keys(GROUP_INFO).map((g, j) => [g, { alone: raw ? 0.05 * j : 0.01 * j, added: g === 'track_record' ? 0.2 : 0.002 }])),
    variables: Object.fromEntries(Object.keys(VARIABLE_LABELS).map((v, j) => [v, { r: ((j % 7) - 3) / 10, n: 2500, coverage: 0.9 }])),
    models: { assumptions: raw ? 0.12 : 0.02, fair_context: raw ? 0.45 : 0.1, everything_known: raw ? 0.55 : 0.12, with_track_record: raw ? 0.8 : 0.2 },
    noiseShare: raw ? 0.2 : null,
    persistence: [
      { periodStart: '2018-01-01', periodEnd: '2018-12-31', yearsBack: 6.7, overlapping: false, r: raw ? 0.8 : 0.3, n: 2000 },
      { periodStart: '2024-01-01', periodEnd: '2024-12-31', yearsBack: 0.7, overlapping: true, r: 0.95, n: 2100 },
    ],
  }
}

const data: PredictorsOverview = {
  runId: 12,
  computedAt: '2026-10-20T17:00:00.000Z',
  measures: MEASURES.map(([id, c]) => measure([id, c, c === 'wait_times' || c === 'satisfaction'], 0)),
  correlations: [
    { a: 'H_COMP_1_STAR_RATING', b: 'OP_18b', r: 0.28, n: 2900 },
    { a: 'MORT_30_AMI', b: 'PSI_90', r: 0.13, n: 1900 },
    { a: 'OP_18b', b: 'READM_30_HF', r: -0.04, n: 3000 },
  ],
}

describe('PredictorsReport', () => {
  const html = renderToStaticMarkup(<PredictorsReport data={data} />)

  it('renders every part from the data', () => {
    for (const title of ['What we expected to matter', 'Searching for better predictors', "The best predictor: a hospital's own past", 'Is quality one thing?', 'What we learned']) {
      expect(html).toContain(title.replace("'", '&#x27;'))
    }
    expect(html).toContain('80%') // with track record, best measure
    expect(html).toContain('about 7 years')
    expect(html).toContain('both part of the patient')
  })

  it('shows the first measure\'s group table, strongest first', () => {
    const track = html.indexOf(GROUP_INFO.track_record.name.replace("'", '&#x27;'))
    const profit = html.indexOf(GROUP_INFO.profit.name)
    expect(track).toBeGreaterThan(-1)
    expect(track).toBeLessThan(profit)
  })
})

describe('predictor labels', () => {
  it('words correlations', () => {
    expect(strengthOf(0.05)).toBe('no real')
    expect(strengthOf(-0.35)).toBe('a moderate')
    expect(formatR(-0.312)).toBe('−0.31')
  })
})
