import fs from 'fs'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import {
  costRow, countyKey, impactRows, latestCmiColumn, latestReports, parseCmsTsv, sviRow,
} from '../src/ingest/context'

describe('CMS tab-delimited files', () => {
  const text = [
    'FY 2027 IPPS Impact File -  Correction Notice (September 2026)\t\t',
    'Provider Number\tName\tFIPS County Code\tURGEO\tResident to Bed Ratio\tDSHPCT\tTACMIV43\tTACMIV44',
    '010001\tSoutheast Health\t01069\tOURBAN\t0.1604\t0.2585\t1.90\t1.95',
    '050454\tUCSF\t06075\tLURBAN\t1.2\t0.31\t2.4\t2.5',
    '090001\tRural One\t\tRURAL\t0\t.\t1.1\t1.2',
    '',
  ].join('\r\n')

  it('finds the header below the title line and reads every hospital row', () => {
    const rows = parseCmsTsv(text, 'Provider Number')
    expect(rows).toHaveLength(3)
    expect(rows[0]['Name']).toBe('Southeast Health')
  })

  it('takes the newest case-mix grouper version and maps rural, FIPS and missing values', () => {
    expect(latestCmiColumn(['TACMIV42', 'TACMIV44', 'TACMIV43', 'CMIV44'])).toBe('TACMIV44')
    const rows = impactRows(parseCmsTsv(text, 'Provider Number'))
    expect(rows[0]).toEqual({
      facilityId: '010001', countyFips: '01069', rural: false, dshPct: 0.2585, caseMixIndex: 1.95, residentBedRatio: 0.1604,
    })
    expect(rows[2]).toMatchObject({ rural: true, countyFips: null, dshPct: null })
  })
})

describe('SVI and county names', () => {
  it('treats -999 as missing', () => {
    expect(sviRow({ RPL_THEMES: '0.73', EP_POV150: '-999', EP_UNINSUR: '8.1' })).toEqual({ svi: 0.73, poverty150: null, uninsured: 8.1 })
  })

  it('matches county names across CMS and CDC spellings', () => {
    expect(countyKey('AL', 'Washington County')).toBe(countyKey('AL', 'WASHINGTON'))
    expect(countyKey('MO', 'St. Louis city')).toBe(countyKey('MO', 'ST. LOUIS CITY'))
    expect(countyKey('MO', 'Saint Charles County')).toBe(countyKey('MO', 'ST CHARLES'))
    expect(countyKey('LA', 'Orleans Parish')).toBe(countyKey('LA', 'ORLEANS'))
    expect(countyKey('MO', 'St. Louis city')).not.toBe(countyKey('MO', 'St. Louis County'))
  })
})

describe('cost reports', () => {
  const row = (ccn: string, end: string, npr: string) => ({
    'Provider CCN': ccn, 'Fiscal Year Begin Date': '01/01/2024', 'Fiscal Year End Date': end, 'Net Patient Revenue': npr,
  })

  it('keeps each hospital\'s latest report and pads CCNs', () => {
    const latest = latestReports([row('10001', '12/31/2023', '100'), row('010001', '12/31/2024', '200'), row('20002', '', '5')].map(costRow))
    expect([...latest.keys()]).toEqual(['010001'])
    expect(latest.get('010001')!.values.net_patient_revenue).toBe(200)
  })
})

describe('hospital_finance_ratios', () => {
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
    const dir = path.join(__dirname, '../migrations')
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      await db.exec(fs.readFileSync(path.join(dir, file), 'utf8'))
    }
    await db.exec(`
      INSERT INTO hospitals (facility_id, name, state) VALUES ('H1', 'One', 'AL'), ('H2', 'Two', 'AL');
      INSERT INTO hospital_finance (facility_id, fiscal_year_end, beds, net_patient_revenue, total_other_income,
                                    net_income_patient, net_income, uncompensated_care, total_costs, total_days,
                                    medicaid_days, bed_days_available, fte_employees, salaries, contract_labor) VALUES
        ('H1', '2024-12-31', 100, 1000, 100, -50, 60, 40, 1050, 20000, 5000, 36500, 600, 400, 20),
        ('H2', '2024-12-31', 0, 0, NULL, 10, 10, 0, 0, 0, 0, 0, 0, 0, 0);
    `)
  })

  afterAll(async () => {
    await db.close()
  })

  it('computes margins and shares, and leaves divisions by zero empty', async () => {
    const { rows } = await db.query<Record<string, number | null>>(
      'SELECT * FROM hospital_finance_ratios ORDER BY facility_id'
    )
    expect(rows[0].patient_margin).toBeCloseTo(-0.05)
    expect(rows[0].total_margin).toBeCloseTo(60 / 1100)
    expect(rows[0].other_income_share).toBeCloseTo(0.1)
    expect(rows[0].medicaid_day_share).toBeCloseTo(0.25)
    expect(rows[0].fte_per_bed).toBeCloseTo(6)
    expect(rows[0].contract_labor_share).toBeCloseTo(0.05)
    expect(rows[1].patient_margin).toBeNull()
    expect(rows[1].fte_per_bed).toBeNull()
  })
})
