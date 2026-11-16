import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Nearby, NearbyHospital } from '../types'
import { NearbyReport } from './NearbyView'

const hospital = (i: number, over: Partial<NearbyHospital> = {}): NearbyHospital => ({
  id: `H${i}`, name: `Hospital ${i}`, city: 'Boston', state: 'MA', hospitalType: 'Acute Care Hospitals',
  emergencyServices: true, overallRating: 4, miles: i, score: 1 - i * 0.1, scoreSe: 0.1, verdict: 'as_expected',
  measures: 30, groups: 5, overallGroups: 5, ...over,
})
const nearby = (hospitals: NearbyHospital[], miles = 25): Nearby => ({ origin: { zip: '02138', approximate: false }, miles, scope: 'overall', hospitals })

describe('NearbyReport', () => {
  it('ranks a short list in one table and leaves specialty hospitals out on request', () => {
    const list = [hospital(1, { verdict: 'better' }), hospital(2, { overallGroups: 3, name: 'Ortho Specialty' }), hospital(3, { verdict: 'worse', emergencyServices: false })]
    const html = renderToStaticMarkup(<NearbyReport data={nearby(list)} fullServiceOnly />)
    expect(html).toContain('3 hospitals within 25 miles of ZIP 02138')
    expect(html).toContain('2 full-service have an overall score (1 specialty hospital left out)')
    expect(html).toContain('Best to worst')
    expect(html).not.toContain('Best nearby')
    expect(html).toContain('No emergency room')
    // The specialty hospital still appears in the full list, flagged.
    expect(html).toContain('All 3 hospitals within 25 miles')
    expect(html).toContain('Specialty (3 of 5 groups)')

    const all = renderToStaticMarkup(<NearbyReport data={nearby(list)} fullServiceOnly={false} />)
    expect(all).toContain('3 have an overall score:')
  })

  it('splits a long list into the best and worst five, numbered from both ends', () => {
    const html = renderToStaticMarkup(<NearbyReport data={nearby(Array.from({ length: 14 }, (_, i) => hospital(i + 1)))} fullServiceOnly />)
    expect(html).toContain('Best nearby')
    expect(html).toContain('Worst nearby')
    const worst = html.slice(html.indexOf('Worst nearby'))
    expect(worst.indexOf('Hospital 14')).toBeLessThan(worst.indexOf('Hospital 13'))
    expect(worst).toContain('>14</td>')
  })

  it('says so when nothing is in range or nothing is scored', () => {
    expect(renderToStaticMarkup(<NearbyReport data={nearby([], 10)} fullServiceOnly />)).toContain('No hospitals within 10 miles of ZIP 02138. Try a wider radius.')
    const unscored = renderToStaticMarkup(<NearbyReport data={nearby([hospital(1, { score: null, scoreSe: null, verdict: null, overallGroups: null })])} fullServiceOnly />)
    expect(unscored).toContain('has enough data for an overall score')
    expect(unscored).toContain('Not enough data')
  })
})
