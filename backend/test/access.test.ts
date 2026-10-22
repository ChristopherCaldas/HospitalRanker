import { describe, expect, it } from 'vitest'
import { acsByZcta, chrRows, gazetteer, miles, PointIndex, urgentCareSites } from '../src/ingest/access'

describe('Census files', () => {
  it('reads tab-delimited (to 2025) and pipe-delimited (2026+) gazetteers', () => {
    const tab = 'GEOID\tALAND\tINTPTLAT\tINTPTLONG                 \n02138\t1\t42.38\t-71.13   \n'
    const pipe = 'GEOID|GEOIDFQ|ALAND|INTPTLAT|INTPTLONG\n02138|860Z200US02138|1|42.38|-71.13\n'
    for (const text of [tab, pipe]) expect(gazetteer(text).get('02138')).toEqual({ lat: 42.38, lon: -71.13 })
  })

  it('keeps ZCTA rows from the ACS summary file and drops missing-value codes', () => {
    const text = 'GEO_ID|B19013_E001|B19013_M001\n0100000US|80734|166\n860Z200US00601|16669|510\n860Z200US00603|-666666666|-222222222\n'
    expect([...acsByZcta(text, 'B19013_E001')]).toEqual([['00601', 16669]])
  })
})

describe('County Health Rankings', () => {
  it('skips the code row and state rows and converts provider rates to per 100k', () => {
    const text = [
      '5-digit FIPS Code,State Abbreviation,Name,Primary Care Physicians raw value,Other Primary Care Providers raw value,Preventable Hospital Stays raw value',
      'fipscode,state,county,v004_rawvalue,v131_rawvalue,v005_rawvalue',
      '01000,AL,Alabama,0.0006,0.001,3500',
      '01001,AL,Autauga County,0.00041,0.0009,3912',
      '01003,AL,Baldwin County,,0.0011,2800',
    ].join('\n')
    const rows = chrRows(text)
    expect(rows.map(r => r.fips)).toEqual(['01001', '01003'])
    expect(rows[0].pcp).toBeCloseTo(41, 6)
    expect(rows[0]).toMatchObject({ name: 'Autauga County', preventable: 3912 })
    expect(rows[1].pcp).toBeNull()
  })
})

describe('urgent care sites', () => {
  const org = (number: number, zip: string, street: string, code = '261QU0200X', type = 'NPI-2') => ({
    number, enumeration_type: type, taxonomies: [{ code: '207Q00000X' }, { code }],
    addresses: [{ address_purpose: 'MAILING', postal_code: '99999', address_1: 'PO BOX 1' },
      { address_purpose: 'LOCATION', postal_code: zip, address_1: street }],
  })

  it('counts each location address once and keeps only urgent care organizations', () => {
    const sites = urgentCareSites([
      org(1, '021381234', '1 Main St.'), org(2, '02138', '1 MAIN ST'), // same site, two NPIs
      org(3, '02139', '5 Elm St'),
      org(4, '02140', '9 Oak St', '282N00000X'), // a hospital, matched by the fuzzy text search
      org(5, '02141', '2 Pine St', '261QU0200X', 'NPI-1'),
    ])
    expect([...sites.values()].sort()).toEqual(['02138', '02139'])
  })
})

describe('distances', () => {
  it('measures miles and finds points within a radius', () => {
    const boston = { lat: 42.36, lon: -71.06 }
    const cambridge = { lat: 42.37, lon: -71.11 }
    const worcester = { lat: 42.26, lon: -71.80 }
    expect(miles(boston, worcester)).toBeGreaterThan(35)
    expect(miles(boston, worcester)).toBeLessThan(40)
    const index = new PointIndex([cambridge, worcester])
    expect(index.within(boston, 10)).toEqual([cambridge])
    expect(index.within(boston, 50)).toHaveLength(2)
  })
})
