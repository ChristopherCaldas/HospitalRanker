import axios from 'axios'
import { parse } from 'csv-parse/sync'
import { Client } from 'pg'
import yauzl from 'yauzl'
import { requireEnv } from '../db/env'
import { toDate, toNumber } from './parse'
import { withRetry } from './retry'

// Hospital-level context for the expected-score model, plus finances:
//   - CMS IPPS final-rule impact file: county, rural, low-income (DSH) %,
//     case mix index, residents per bed. Published each August for the next
//     fiscal year; file names vary by year, so links are read off the rule's
//     home page.
//   - CMS HRRP supplemental file (same page): dual-eligible proportion.
//   - CMS Hospital Provider Cost Report PUF (data.cms.gov, yearly): finances.
//     The newest two years are read and each hospital's latest report kept.
//   - CDC/ATSDR Social Vulnerability Index, county level (every two years).
// Skipped when the combination of file versions was already loaded.
//
//   npm run ingest:context --workspace=backend            # only if something changed
//   npm run ingest:context --workspace=backend -- --force # reload regardless

const SOURCE = 'hospital_context'
const IPPS_PAGE = (fy: number) =>
  `https://www.cms.gov/medicare/payment/prospective-payment-systems/acute-inpatient-pps/fy-${fy}-ipps-final-rule-home-page`
const CATALOG = 'https://data.cms.gov/data.json'
const SVI_YEARS = [2026, 2024, 2022]
const SVI_URL = (year: number) => `https://svi.cdc.gov/Documents/Data/${year}/csv/states_counties/SVI_${year}_US_county.csv`
const force = process.argv.includes('--force')

const ccn = (v: string | undefined) => (v ?? '').trim().padStart(6, '0')
const share = (v: string | undefined) => toNumber(v?.replace('%', ''))

// CMS's tab-delimited exports start with a title line; the header is the
// first line that begins with the ID column.
export function parseCmsTsv(text: string, idColumn: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/)
  const at = lines.findIndex(l => l.split('\t')[0].trim() === idColumn)
  if (at < 0) throw new Error(`no "${idColumn}" header row`)
  const header = lines[at].split('\t').map(h => h.trim())
  return lines
    .slice(at + 1)
    .filter(l => /^\d/.test(l.trim()))
    .map(l => {
      const cells = l.split('\t')
      return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]))
    })
}

// The case-mix column carries the MS-DRG grouper version (TACMIV43, TACMIV44, ...).
export function latestCmiColumn(header: string[]): string | null {
  const versions = header.map(h => h.match(/^TACMIV(\d+)$/)).filter((m): m is RegExpMatchArray => !!m)
  if (versions.length === 0) return null
  return versions.sort((a, b) => Number(b[1]) - Number(a[1]))[0][0]
}

export interface ImpactRow {
  facilityId: string
  countyFips: string | null
  rural: boolean | null
  dshPct: number | null
  caseMixIndex: number | null
  residentBedRatio: number | null
}

export function impactRows(rows: Record<string, string>[]): ImpactRow[] {
  const cmi = latestCmiColumn(Object.keys(rows[0] ?? {}))
  return rows.map(r => ({
    facilityId: ccn(r['Provider Number']),
    countyFips: /^\d{5}$/.test(r['FIPS County Code'] ?? '') ? r['FIPS County Code'] : null,
    rural: r['URGEO'] ? r['URGEO'] === 'RURAL' : null,
    dshPct: toNumber(r['DSHPCT']),
    caseMixIndex: cmi ? toNumber(r[cmi]) : null,
    residentBedRatio: toNumber(r['Resident to Bed Ratio']),
  }))
}

export interface SviRow { svi: number | null; poverty150: number | null; uninsured: number | null }

// SVI marks missing values as -999.
export function sviRow(r: Record<string, string>): SviRow {
  const v = (k: string) => {
    const n = toNumber(r[k])
    return n === null || n < 0 ? null : n
  }
  return { svi: v('RPL_THEMES'), poverty150: v('EP_POV150'), uninsured: v('EP_UNINSUR') }
}

// County names as written in Hospital General Information ("ST. LOUIS CITY",
// "DE KALB") and in SVI ("St. Louis city", "DeKalb County") reduced to one key.
export function countyKey(state: string, county: string): string {
  const name = county
    .toUpperCase()
    .replace(/\b(COUNTY|PARISH|BOROUGH|CENSUS AREA|CITY AND BOROUGH|MUNICIPALITY|MUNICIPIO)\b/g, '')
    .replace(/\bSAINT\b/g, 'ST')
    .replace(/[^A-Z]/g, '')
  return `${state}|${name}`
}

// Cost report column -> hospital_finance column.
export const COST_FIELDS: Record<string, string> = {
  'Number of Beds': 'beds',
  'Net Patient Revenue': 'net_patient_revenue',
  'Total Other Income': 'total_other_income',
  'Less Total Operating Expense': 'operating_expense',
  'Net Income from Service to Patients': 'net_income_patient',
  'Net Income': 'net_income',
  'Cost of Uncompensated Care': 'uncompensated_care',
  'Cost of Charity Care': 'charity_care',
  'Total Costs': 'total_costs',
  'Total Days (V + XVIII + XIX + Unknown)': 'total_days',
  'Total Days Title XIX': 'medicaid_days',
  'Total Days Title XVIII': 'medicare_days',
  'Total Bed Days Available': 'bed_days_available',
  'FTE - Employees on Payroll': 'fte_employees',
  'Total Salaries From Worksheet A': 'salaries',
  'Contract Labor: Direct Patient Care': 'contract_labor',
}

export interface CostRow {
  facilityId: string
  fiscalYearBegin: string | null
  fiscalYearEnd: string | null
  values: Record<string, number | null>
}

export function costRow(r: Record<string, string>): CostRow {
  return {
    facilityId: ccn(r['Provider CCN']),
    fiscalYearBegin: toDate(r['Fiscal Year Begin Date']),
    fiscalYearEnd: toDate(r['Fiscal Year End Date']),
    values: Object.fromEntries(Object.entries(COST_FIELDS).map(([src, col]) => [col, toNumber(r[src])])),
  }
}

// A hospital can file more than one report (e.g. a change of fiscal year);
// keep the one ending last, preferring earlier files' rows only as fallback.
export function latestReports(rows: CostRow[]): Map<string, CostRow> {
  const out = new Map<string, CostRow>()
  for (const r of rows) {
    if (!r.fiscalYearEnd) continue
    const prev = out.get(r.facilityId)
    if (!prev || r.fiscalYearEnd > prev.fiscalYearEnd!) out.set(r.facilityId, r)
  }
  return out
}

async function get(url: string, responseType: 'text' | 'arraybuffer' = 'text') {
  return withRetry(`download ${url}`, async () => {
    const { data } = await axios.get(url, { responseType, timeout: 300_000 })
    return data
  })
}

async function zipTexts(buf: Buffer): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, z) => (err ? reject(err) : resolve(z)))
  )
  await new Promise<void>((resolve, reject) => {
    zip.on('error', reject).on('end', resolve)
    zip.on('entry', (entry: yauzl.Entry) => {
      if (!/\.txt$/i.test(entry.fileName)) return zip.readEntry()
      zip.openReadStream(entry, (err, stream) => {
        if (err) return reject(err)
        const chunks: Buffer[] = []
        stream.on('data', c => chunks.push(c)).on('error', reject).on('end', () => {
          out.set(entry.fileName, Buffer.concat(chunks).toString('latin1'))
          zip.readEntry()
        })
      })
    })
    zip.readEntry()
  })
  return out
}

// Newest fiscal year whose final-rule page links both files.
async function findIpps(): Promise<{ fy: number; impactUrl: string; hrrpUrl: string }> {
  const year = new Date().getUTCFullYear()
  for (const fy of [year + 1, year, year - 1]) {
    const html: string = await axios.get(IPPS_PAGE(fy), { timeout: 60_000 }).then(r => r.data, () => '')
    const links = [...html.matchAll(/href="([^"]+\.zip)"/g)].map(m => m[1])
    const impact = links.find(l => /ipps-fr-impact-file\.zip$/.test(l))
    const hrrp = links.find(l => /readmissions-reduction-program-supplemental-data-file\.zip$/.test(l))
    if (impact && hrrp) {
      const abs = (l: string) => new URL(l, 'https://www.cms.gov').toString()
      return { fy, impactUrl: abs(impact), hrrpUrl: abs(hrrp) }
    }
  }
  throw new Error('no IPPS final rule page with an impact file and HRRP supplemental file')
}

async function findCostReports(): Promise<{ title: string; url: string }[]> {
  const { data } = await withRetry('cms catalog', () => axios.get(CATALOG, { timeout: 120_000 }))
  const entries = (data.dataset as { title: string; distribution?: { downloadURL?: string; mediaType?: string }[] }[])
    .filter(d => /^Hospital Provider Cost Report : \d{4}/.test(d.title))
    .map(d => ({ title: d.title, url: d.distribution?.find(x => x.mediaType === 'text/csv')?.downloadURL }))
    .filter((d): d is { title: string; url: string } => !!d.url)
    .sort((a, b) => b.title.localeCompare(a.title))
  if (entries.length === 0) throw new Error('no Hospital Provider Cost Report in the CMS catalog')
  return entries.slice(0, 2)
}

async function findSvi(): Promise<{ year: number; url: string }> {
  for (const year of SVI_YEARS) {
    const ok = await axios.head(SVI_URL(year), { timeout: 30_000 }).then(() => true, () => false)
    if (ok) return { year, url: SVI_URL(year) }
  }
  throw new Error('no CDC SVI county file found')
}

async function main() {
  const [ipps, costs, svi] = await Promise.all([findIpps(), findCostReports(), findSvi()])
  const version = `IPPS FY${ipps.fy} | ${costs.map(c => c.title.replace('Hospital Provider Cost Report : ', 'cost ')).join(', ')} | SVI ${svi.year}`
  const db = new Client({ connectionString: requireEnv('DATABASE_URL_UNPOOLED') })
  await db.connect()
  try {
    const { rowCount } = await db.query('SELECT 1 FROM source_loads WHERE source = $1 AND version = $2', [SOURCE, version])
    if (rowCount && !force) {
      console.log(`= hospital context (${version}): already loaded`)
      return
    }

    // IPPS impact + HRRP
    const impactFiles = await zipTexts(Buffer.from(await get(ipps.impactUrl, 'arraybuffer')))
    const impactName = [...impactFiles.keys()]
      .filter(n => !/descri/i.test(n))
      .sort((a, b) => +/correction/i.test(b) - +/correction/i.test(a))[0]
    if (!impactName) throw new Error('impact zip has no data file')
    const impact = impactRows(parseCmsTsv(impactFiles.get(impactName)!, 'Provider Number'))
    const hrrpFiles = await zipTexts(Buffer.from(await get(ipps.hrrpUrl, 'arraybuffer')))
    const hrrpName = [...hrrpFiles.keys()].find(n => !/descri|case info/i.test(n))
    if (!hrrpName) throw new Error('HRRP zip has no data file')
    const dual = new Map(parseCmsTsv(hrrpFiles.get(hrrpName)!, 'Hospital CCN').map(r => [ccn(r['Hospital CCN']), share(r['Dual proportion'])]))

    // SVI by county
    const sviRows = parse(await get(svi.url), { columns: true, bom: true }) as Record<string, string>[]
    const byCounty = new Map(sviRows.map(r => [r.FIPS.padStart(5, '0'), sviRow(r)]))
    // Hospitals outside the IPPS files (critical access, Maryland) have no FIPS
    // code there; match their county by name instead. Independent cities like
    // "Baltimore city" share a name with a county, so names seen twice are dropped.
    const byName = new Map<string, SviRow | null>()
    for (const r of sviRows) {
      const key = countyKey(r.ST_ABBR, r.COUNTY)
      byName.set(key, byName.has(key) ? null : sviRow(r))
    }

    // Cost reports: newest file first, so its rows win ties
    const reports: CostRow[] = []
    for (const c of [...costs].reverse()) {
      reports.push(...(parse(await get(c.url), { columns: true, bom: true, relax_column_count: true }) as Record<string, string>[]).map(costRow))
    }
    const finance = latestReports(reports)

    const { rows: known } = await db.query<{ facility_id: string; state: string | null; county: string | null; hospital_type: string | null }>(
      'SELECT facility_id, state, county, hospital_type FROM hospitals'
    )
    const hospitals = new Set(known.map(r => r.facility_id))
    const impactBy = new Map(impact.map(r => [r.facilityId, r]))
    const sources = { ipps: `FY${ipps.fy} ${impactName}`, hrrp: `FY${ipps.fy}`, svi: svi.year }

    await db.query('BEGIN')
    await db.query('DELETE FROM hospital_context')
    const ctx = known
      .map(h => {
        const id = h.facility_id
        const im = impactBy.get(id)
        const area = im?.countyFips
          ? byCounty.get(im.countyFips)
          : h.state && h.county ? byName.get(countyKey(h.state, h.county)) ?? undefined : undefined
        // Critical access hospitals must be rural (or treated as rural) by law.
        const rural = im?.rural ?? (h.hospital_type === 'Critical Access Hospitals' ? true : null)
        return [id, im?.countyFips ?? null, rural, im?.dshPct ?? null, im?.caseMixIndex ?? null,
          im?.residentBedRatio ?? null, dual.get(id) ?? null, area?.svi ?? null, area?.poverty150 ?? null, area?.uninsured ?? null]
      })
      .filter(r => r.slice(1).some(v => v !== null && v !== undefined))
    const col = (rows: unknown[][], i: number) => rows.map(r => r[i])
    await db.query(
      `INSERT INTO hospital_context (facility_id, county_fips, rural, dsh_pct, case_mix_index, resident_bed_ratio,
                                     dual_proportion, svi_percentile, poverty150_pct, uninsured_pct, sources)
       SELECT *, $11::jsonb FROM unnest($1::text[], $2::text[], $3::boolean[], $4::float8[], $5::float8[], $6::float8[],
                                        $7::float8[], $8::float8[], $9::float8[], $10::float8[])`,
      [...Array.from({ length: 10 }, (_, i) => col(ctx, i)), JSON.stringify(sources)]
    )

    await db.query('DELETE FROM hospital_finance')
    const fin = [...finance.values()].filter(r => hospitals.has(r.facilityId))
    const fcols = Object.values(COST_FIELDS)
    await db.query(
      `INSERT INTO hospital_finance (facility_id, fiscal_year_begin, fiscal_year_end, ${fcols.join(', ')})
       SELECT * FROM unnest($1::text[], $2::date[], $3::date[], ${fcols.map((c, i) => `$${i + 4}::${c === 'beds' ? 'integer' : 'float8'}[]`).join(', ')})`,
      [fin.map(r => r.facilityId), fin.map(r => r.fiscalYearBegin), fin.map(r => r.fiscalYearEnd),
        ...fcols.map(c => fin.map(r => (c === 'beds' && r.values[c] !== null ? Math.round(r.values[c]!) : r.values[c])))]
    )
    await db.query(
      `INSERT INTO source_loads (source, version, row_count) VALUES ($1, $2, $3)
       ON CONFLICT (source, version) DO UPDATE SET row_count = EXCLUDED.row_count, loaded_at = now()`,
      [SOURCE, version, ctx.length + fin.length]
    )
    await db.query('COMMIT')
    console.log(`+ hospital context (${version}): ${ctx.length} hospitals with context, ${fin.length} with a cost report`)

    const { rows: coverage } = await db.query(`
      SELECT count(*) AS context, count(dual_proportion) AS dual, count(dsh_pct) AS dsh, count(case_mix_index) AS cmi,
             count(svi_percentile) AS svi, (SELECT count(*) FROM hospital_finance) AS finance
      FROM hospital_context`)
    console.table(coverage)
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await db.end()
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
