import { describe, expect, it } from 'vitest'
import { reportingPeriod, toBool, toDate, toInt, toNumber, toText } from '../src/ingest/parse'

describe('CMS value parsing', () => {
  it('treats CMS sentinel strings as missing', () => {
    for (const v of ['', ' ', 'Not Available', 'Not Applicable', 'N/A', undefined]) {
      expect(toNumber(v)).toBeNull()
      expect(toText(v)).toBeNull()
    }
  })

  it('parses numbers, including thousands separators', () => {
    expect(toNumber('13.5')).toBe(13.5)
    expect(toNumber('1,392')).toBe(1392)
    expect(toNumber('59878.0')).toBe(59878)
    expect(toNumber('Low')).toBeNull()
  })

  it('rounds integers', () => {
    expect(toInt('396')).toBe(396)
    expect(toInt('59878.6')).toBe(59879)
    expect(toInt('Not Available')).toBeNull()
  })

  it('converts MM/DD/YYYY to ISO dates and rejects other formats', () => {
    expect(toDate('07/01/2022')).toBe('2022-07-01')
    expect(toDate('2022-07-01')).toBeNull()
    expect(toDate(undefined)).toBeNull()
  })

  it('parses yes/no flags', () => {
    expect(toBool('Yes')).toBe(true)
    expect(toBool('Y')).toBe(true)
    expect(toBool('no')).toBe(false)
    expect(toBool('')).toBeNull()
  })
})

describe('CDC reporting period', () => {
  it('splits on the mandate boundaries', () => {
    expect(reportingPeriod('2024-04-27')).toBe('mandated_2020')
    expect(reportingPeriod('2024-05-04')).toBe('voluntary_2024')
    expect(reportingPeriod('2024-10-26')).toBe('voluntary_2024')
    expect(reportingPeriod('2024-11-02')).toBe('mandated_2024')
  })
})
