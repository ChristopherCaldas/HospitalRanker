import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChainTest, EquityFifth, MoneyMetric, Scope } from '../types'
import { EquityReport } from './EquityView'
import { ChainReport } from '../components/ChainSection'

const SCOPES: Scope[] = ['overall', 'outcome', 'process', 'mortality', 'safety', 'readmission', 'experience', 'timely_effective']
const MONEY: MoneyMetric[] = ['patient_margin', 'total_margin', 'uncompensated', 'other_income', 'cost_per_discharge', 'fte_per_bed', 'salary_per_fte', 'contract_labor']

// Raw scores fall with poverty; adjustment removes the gap, except mortality,
// where the poorest fifth looks better raw but worse adjusted.
function fifth(i: number): EquityFifth {
  return {
    fifth: i + 1, dualLow: 0.1 * i, dualHigh: 0.1 * (i + 1), hospitals: 580,
    scores: Object.fromEntries(SCOPES.map(s => [s, s === 'mortality'
      ? { raw: 0.02 * i, adjusted: -0.06 * i, n: 500 }
      : { raw: 0.1 - 0.1 * i, adjusted: -0.01 * i, n: 500 }])) as EquityFifth['scores'],
    money: Object.fromEntries(MONEY.map(m => [m, { median: m === 'total_margin' ? 0.11 - 0.02 * i : 0.5, n: 500 }])) as EquityFifth['money'],
    within: Object.fromEntries(MONEY.map(m => [m, { spearman: m === 'contract_labor' ? -0.2 : 0.05, n: 500 }])) as EquityFifth['within'],
    medianMspb: 0.98 + 0.01 * i,
  }
}

describe('EquityReport', () => {
  const html = renderToStaticMarkup(<EquityReport fifths={[0, 1, 2, 3, 4].map(fifth)} />)

  it('reports the gap before and after adjustment', () => {
    expect(html).toContain('score lower')
    expect(html).toContain('−0.40') // raw overall gap
    expect(html).toContain('most of the raw difference reflects who the hospitals serve')
  })

  it('calls out a score where adjustment reverses the picture', () => {
    expect(html).toContain('For mortality, adjusting')
    expect(html).toContain('+0.08 before, −0.24 after')
  })

  it('names the strongest within-group money link', () => {
    expect(html).toContain('Agency staff (share of salaries)</strong> shows the strongest link')
  })
})

const t = (link: ChainTest['link'], x: string, y: string, r: number, extra: Partial<ChainTest> = {}): ChainTest => ({
  link, x, y, n: 2500, r, rCiLow: r - 0.04, rCiHigh: r + 0.04, spearman: r, partialR: null,
  qValue: Math.abs(r) > 0.04 ? 0.001 : 0.4, topFifth: r, bottomFifth: -r, ...extra,
})

describe('ChainReport', () => {
  const html = renderToStaticMarkup(<ChainReport tests={[
    t('structure_process', 'cost_per_discharge', 'process', 0.22),
    t('structure_process', 'beds', 'process', -0.22),
    t('structure_outcome', 'cost_per_discharge', 'clinical_outcome', 0.06, { partialR: 0.02 }),
    t('structure_outcome', 'beds', 'clinical_outcome', -0.06, { partialR: -0.02 }),
    t('structure_process', 'in_system', 'process', -0.05),
    t('structure_outcome', 'in_system', 'clinical_outcome', 0.12, { partialR: 0.14 }),
    t('process_outcome', 'process', 'clinical_outcome', 0.2),
    t('process_outcome', 'timely_effective', 'clinical_outcome', 0.08),
    t('pair', 'SEP_1', 'MORT_30_PN', 0.01),
    t('pair', 'H_COMP_6_STAR_RATING', 'readmission', 0.13),
  ]} />)

  it('summarizes each link from the data', () => {
    expect(html).toContain('Better process goes with more spending per patient (0.22), fewer beds (-0.22)')
    expect(html).toContain('A modest link (r = 0.20)')
    expect(html).toContain('Part of a health system: linked to outcomes even with process held equal')
    expect(html).toContain('Spending per patient, Size (beds): linked to outcomes mostly')
  })

  it('marks which clinical pairs are clear', () => {
    expect(html).toMatch(/Pneumonia deaths.*?<td class="px-4 py-2">No<\/td>/s)
    expect(html).toMatch(/Discharge information.*?<td class="px-4 py-2">Yes<\/td>/s)
  })
})
