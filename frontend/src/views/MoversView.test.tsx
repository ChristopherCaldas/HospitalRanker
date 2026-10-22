import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Category, MeasureMovers } from '../types'
import { CHANGE_GROUP_INFO, formatChange } from '../lib/movers'
import { MoversReport, relativeFifths } from './MoversView'

const CATS: [string, Category, string][] = [
  ['OP_18b', 'wait_times', 'minutes'], ['MORT_30_AMI', 'mortality', 'percent'], ['PSI_90', 'safety', 'ratio'],
  ['H_COMP_1_STAR_RATING', 'satisfaction', 'stars'], ['READM_30_HF', 'readmission', 'percent'],
]

function measure([measureId, category, unit]: (typeof CATS)[number]): MeasureMovers {
  return {
    measureId, category, unit, higherIsBetter: category === 'satisfaction',
    from: { start: '2019-07-01', end: '2022-06-30' }, to: { start: '2022-07-01', end: '2025-06-30' },
    hospitals: 2000, rtmSlope: 0.3, tau: 1, improved: 10, declined: 30, detectable: 200, rawJumps: 40, rawDrops: 40,
    // everyone got 1 point worse; the worst fifth less so (pulled toward the middle)
    fifths: [1, 2, 3, 4, 5].map(f => ({ fifth: f, hospitals: 400, avgChange: -1 + (3 - f) * 0.5, se: 0.05 })),
    predictors: { groups: Object.fromEntries(Object.keys(CHANGE_GROUP_INFO).map(g => [g, { alone: 0.01, added: 0 }])), variables: {}, everything: 0.03 },
    ownership: { hospitals: 80, effect: -0.1, se: 0.15, improved: 0, declined: 1 },
    movers: [{
      facilityId: '330399', name: 'ST BARNABAS HOSPITAL', city: 'BRONX', state: 'NY', startScore: 21.9, endScore: 27.6,
      expectedEnd: 21.8, change: -5.8, changeSe: 1.2, verdict: 'declined', ownershipChange: false, history: [],
    }],
  }
}

describe('MoversReport', () => {
  const data = CATS.map(measure)
  const html = renderToStaticMarkup(<MoversReport data={data} category="readmission" />)

  it('renders every part from the data', () => {
    for (const title of ['The trap: regression to the mean', 'How rare real change is', 'Who changed', 'Could anyone have seen it coming?', 'What we learned']) {
      expect(html).toContain(title)
    }
    expect(html).toContain('ST BARNABAS HOSPITAL')
    expect(html).toContain('made no clear difference on any measure')
  })

  it('takes out changes that hit every hospital before showing the pull to the middle', () => {
    const rel = relativeFifths(data[0])
    expect(rel[2].avgChange).toBeCloseTo(0)
    expect(rel[0].avgChange).toBeCloseTo(1)
  })

  it('words changes in the measure\'s units', () => {
    expect(formatChange(12.4, 'minutes')).toBe('12 min better')
    expect(formatChange(-5.8, 'percent')).toBe('5.8 pts worse')
  })
})
