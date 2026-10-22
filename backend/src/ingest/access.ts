import axios from 'axios'
import { parse } from 'csv-parse/sync'
import { Client } from 'pg'
import yauzl from 'yauzl'
import { requireEnv } from '../db/env'
import { countyKey, get } from './context'
import { toNumber } from './parse'
import { withRetry } from './retry'

// Primary-care and urgent-care access around each hospital. The idea being
// tested: in low-income areas the ER doubles as primary and urgent care,
// while in better-off areas urgent care centers and doctors' offices take
// some of that load.
//   - County Health Rankings (yearly): primary care physicians and other
//     primary care providers per capita, preventable hospital stays.
//   - CMS Medicare Geographic Variation PUF, county level (newest year): ER
//     visits and office visits per 1,000 Original Medicare beneficiaries.
//   - Within LOCAL_MILES of the hospital: population and income (Census ACS
//     5-year by ZCTA), urgent care sites (NPPES, the national provider
//     registry), HRSA health center sites, and other hospitals' ERs.
// Locations are ZIP (ZCTA) centroids from the Census Gazetteer. NPPES has no
// bulk query, so urgent cares are listed ZIP3 by ZIP3 through its API.
// Skipped when the combination of file versions was already loaded.
//
//   npm run ingest:access --workspace=backend            # only if something changed
//   npm run ingest:access --workspace=backend -- --force # reload regardless

const SOURCE = 'hospital_access'
export const LOCAL_MILES = 10
const INCOME_MILES = 5
const CHR_URLS = (year: number) => [
  `https://www.countyhealthrankings.org/sites/default/files/media/document/analytic_data${year}_v2.csv`,
  `https://www.countyhealthrankings.org/sites/default/files/media/document/analytic_data${year}.csv`,
]
const CATALOG = 'https://data.cms.gov/data.json'
const GV_TITLE = /^Medicare Geographic Variation - by National, State & County/
const ACS_URL = (year: number, table: string) =>
  `https://www2.census.gov/programs-surveys/acs/summary_file/${year}/table-based-SF/data/5YRData/acsdt5y${year}-${table}.dat`
const GAZETTEER_URL = (year: number) =>
  `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${year}_Gazetteer/${year}_Gaz_zcta_national.zip`
const HRSA_SITES = 'https://data.hrsa.gov/DataDownload/DD_Files/Health_Center_Service_Delivery_and_LookAlike_Sites.csv'
const NPPES = 'https://npiregistry.cms.hhs.gov/api/'
const URGENT_CARE = '261QU0200X'
const force = process.argv.includes('--force')

export interface Point { lat: number; lon: number }

export function miles(a: Point, b: Point): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.sqrt(h))
}

// Points bucketed by whole degree, so a radius search only looks at nearby cells.
export class PointIndex<T extends Point> {
  private cells = new Map<string, T[]>()
  constructor(points: T[]) {
    for (const p of points) {
      const key = `${Math.floor(p.lat)}|${Math.floor(p.lon)}`
      const cell = this.cells.get(key)
      if (cell) cell.push(p)
      else this.cells.set(key, [p])
    }
  }
  within(center: Point, radius: number): T[] {
    const dLat = Math.ceil(radius / 69)
    // Degrees of longitude shrink toward the poles; Alaska needs a wider window.
    const dLon = Math.ceil(radius / (69 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180))))
    const out: T[] = []
    for (let i = Math.floor(center.lat) - dLat; i <= Math.floor(center.lat) + dLat; i++) {
      for (let j = Math.floor(center.lon) - dLon; j <= Math.floor(center.lon) + dLon; j++) {
        for (const p of this.cells.get(`${i}|${j}`) ?? []) if (miles(center, p) <= radius) out.push(p)
      }
    }
    return out
  }
}

const zip5 = (v: string | undefined | null) => {
  const m = (v ?? '').trim().match(/^(\d{5})/)
  return m ? m[1] : null
}

// Census Gazetteer: ZCTA -> internal point. Tab-delimited through 2025,
// pipe-delimited since.
export function gazetteer(text: string): Map<string, Point> {
  const lines = text.split(/\r?\n/)
  const sep = lines[0].includes('|') ? '|' : '\t'
  const header = lines[0].split(sep).map(h => h.trim())
  const [id, lat, lon] = ['GEOID', 'INTPTLAT', 'INTPTLONG'].map(h => header.indexOf(h))
  const out = new Map<string, Point>()
  for (const l of lines.slice(1)) {
    const c = l.split(sep).map(v => v.trim())
    if (c[id]) out.set(c[id], { lat: Number(c[lat]), lon: Number(c[lon]) })
  }
  return out
}

// ACS table-based summary file (pipe-delimited, every geography): ZCTA ->
// estimate. Negative values are the Census's missing-value codes.
export function acsByZcta(text: string, column: string): Map<string, number> {
  const lines = text.split(/\r?\n/)
  const header = lines[0].split('|')
  const at = header.indexOf(column)
  const out = new Map<string, number>()
  for (const l of lines) {
    if (!l.startsWith('860Z200US')) continue
    const c = l.split('|')
    const v = Number(c[at])
    if (Number.isFinite(v) && v >= 0) out.set(c[0].slice(9), v)
  }
  return out
}

export interface ChrRow { fips: string; state: string; name: string; pcp: number | null; otherPc: number | null; preventable: number | null }

// County Health Rankings analytic file: the first row has readable names, the
// second short codes (skipped). Provider rates are per person -> per 100k.
export function chrRows(text: string): ChrRow[] {
  const rows = parse(text, { columns: true, bom: true, relax_column_count: true }) as Record<string, string>[]
  const per100k = (v: string | undefined) => {
    const n = toNumber(v)
    return n === null ? null : n * 1e5
  }
  return rows
    .filter(r => /^\d{5}$/.test(r['5-digit FIPS Code'] ?? '') && !r['5-digit FIPS Code'].endsWith('000'))
    .map(r => ({
      fips: r['5-digit FIPS Code'],
      state: r['State Abbreviation'],
      name: r['Name'],
      pcp: per100k(r['Primary Care Physicians raw value']),
      otherPc: per100k(r['Other Primary Care Providers raw value']),
      preventable: toNumber(r['Preventable Hospital Stays raw value']),
    }))
}

export interface NppesResult {
  number: string | number
  enumeration_type?: string
  addresses?: { address_purpose?: string; address_1?: string; postal_code?: string }[]
  taxonomies?: { code?: string }[]
}

// Urgent care organizations' location addresses, one per distinct address
// (one site often has several NPIs).
export function urgentCareSites(results: NppesResult[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of results) {
    if (r.enumeration_type !== 'NPI-2' || !r.taxonomies?.some(t => t.code === URGENT_CARE)) continue
    const loc = r.addresses?.find(a => a.address_purpose === 'LOCATION')
    const zip = zip5(loc?.postal_code)
    if (!loc || !zip) continue
    const key = `${zip}|${(loc.address_1 ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')}`
    out.set(key, zip)
  }
  return out
}

async function nppesPage(prefix: string, skip: number): Promise<NppesResult[]> {
  return withRetry(`nppes ${prefix}* +${skip}`, async () => {
    const { data } = await axios.get(NPPES, {
      params: { version: '2.1', taxonomy_description: 'Urgent Care', postal_code: `${prefix}*`, limit: 200, skip },
      timeout: 60_000,
    })
    if (data?.Errors) {
      // "No results" comes back as an error object.
      if (JSON.stringify(data.Errors).match(/no .*found/i)) return []
      throw new Error(JSON.stringify(data.Errors))
    }
    return (data?.results ?? []) as NppesResult[]
  })
}

// The API returns at most 1,200 rows per query (skip <= 1000), so a full
// prefix is split one digit further.
async function nppesPrefix(prefix: string): Promise<NppesResult[]> {
  const out: NppesResult[] = []
  for (let skip = 0; skip <= 1000; skip += 200) {
    const page = await nppesPage(prefix, skip)
    out.push(...page)
    if (page.length < 200) return out
  }
  if (prefix.length >= 5) return out
  const parts = await Promise.all(Array.from({ length: 10 }, (_, d) => nppesPrefix(`${prefix}${d}`)))
  return parts.flat()
}

async function allUrgentCares(zip3s: string[]): Promise<Map<string, string>> {
  const results: NppesResult[] = []
  const queue = [...zip3s]
  let done = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      results.push(...(await nppesPrefix(p)))
      if (++done % 100 === 0) console.log(`  nppes: ${done}/${zip3s.length} ZIP3 prefixes`)
    }
  }))
  return urgentCareSites(results)
}

async function unzipFirst(buf: Buffer): Promise<string> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, z) => (err ? reject(err) : resolve(z)))
  )
  return new Promise((resolve, reject) => {
    zip.on('error', reject)
    zip.once('entry', (entry: yauzl.Entry) =>
      zip.openReadStream(entry, (err, stream) => {
        if (err) return reject(err)
        const chunks: Buffer[] = []
        stream.on('data', c => chunks.push(c)).on('error', reject).on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      })
    )
    zip.readEntry()
  })
}

const exists = (url: string) => axios.head(url, { timeout: 30_000 }).then(() => true, () => false)

async function firstExisting<T>(candidates: [T, string][]): Promise<[T, string]> {
  for (const c of candidates) if (await exists(c[1])) return c
  throw new Error(`none found: ${candidates.map(c => c[1]).join(', ')}`)
}

// Newest year with county rows in the Geographic Variation API.
async function gvCounties(): Promise<{ year: number; rows: Record<string, string>[] }> {
  const { data } = await withRetry('cms catalog', () => axios.get(CATALOG, { timeout: 120_000 }))
  const entry = data.dataset.find((d: { title: string }) => GV_TITLE.test(d.title))
  const apiUrl = entry?.identifier?.replace(/\/data-viewer$/, '/data')
  if (!apiUrl) throw new Error('Geographic Variation dataset not found in catalog')
  for (let year = new Date().getUTCFullYear(); year >= 2020; year--) {
    const rows: Record<string, string>[] = []
    for (let offset = 0; ; offset += 5000) {
      const { data: page } = await withRetry('medicare gv counties', () => axios.get(apiUrl, {
        params: {
          'filter[BENE_GEO_LVL]': 'County', 'filter[BENE_AGE_LVL]': 'All', 'filter[YEAR]': String(year),
          column: 'BENE_GEO_CD,ER_VISITS_PER_1000_BENES,EM_EVNTS_PER_1000_BENES', size: 5000, offset,
        },
        timeout: 120_000,
      }))
      rows.push(...page)
      if (page.length < 5000) break
    }
    if (rows.length > 0) return { year, rows }
  }
  throw new Error('no county rows in the Geographic Variation API')
}

async function main() {
  const year = new Date().getUTCFullYear()
  const [[chrYear, chrUrl], [acsYear], [gazYear, gazUrl]] = await Promise.all([
    firstExisting(CHR_URLS(year).concat(CHR_URLS(year - 1), CHR_URLS(year - 2)).map((u, i) => [year - Math.floor(i / 2), u] as [number, string])),
    firstExisting([year - 1, year - 2, year - 3].map(y => [y, ACS_URL(y, 'b01003')] as [number, string])),
    firstExisting([year, year - 1, year - 2].map(y => [y, GAZETTEER_URL(y)] as [number, string])),
  ])
  const gv = await gvCounties()
  // NPPES and HRSA have no version; the month stands in for one.
  const month = new Date().toISOString().slice(0, 7)
  const version = `CHR ${chrYear} | GV ${gv.year} | ACS ${acsYear} | ZCTA ${gazYear} | NPPES+HRSA ${month}`

  const db = new Client({ connectionString: requireEnv('DATABASE_URL_UNPOOLED') })
  await db.connect()
  try {
    const { rowCount } = await db.query('SELECT 1 FROM source_loads WHERE source = $1 AND version = $2', [SOURCE, version])
    if (rowCount && !force) {
      console.log(`= hospital access (${version}): already loaded`)
      return
    }

    const [chrText, gazZip, popText, incomeText, hrsaText] = await Promise.all([
      get(chrUrl), get(gazUrl, 'arraybuffer'), get(ACS_URL(acsYear, 'b01003')), get(ACS_URL(acsYear, 'b19013')), get(HRSA_SITES),
    ])
    const chr = chrRows(chrText)
    const chrByFips = new Map(chr.map(r => [r.fips, r]))
    const chrByName = new Map<string, ChrRow | null>()
    for (const r of chr) {
      const key = countyKey(r.state, r.name)
      chrByName.set(key, chrByName.has(key) ? null : r)
    }
    const gvByFips = new Map(gv.rows.map(r => [r.BENE_GEO_CD, r]))

    const zcta = gazetteer(await unzipFirst(Buffer.from(gazZip)))
    const pop = acsByZcta(popText, 'B01003_E001')
    const income = acsByZcta(incomeText, 'B19013_E001')
    const areas = new PointIndex([...zcta].map(([id, p]) => ({ ...p, pop: pop.get(id) ?? 0, income: income.get(id) ?? null })))

    const hrsa = (parse(hrsaText, { columns: true, bom: true, relax_column_count: true }) as Record<string, string>[])
      .filter(r => r['Health Center Location Type Description'] === 'Permanent' &&
        r['Health Center Service Delivery Site Location Setting Description'] !== 'School')
      .map(r => ({ lat: Number(r['Geocoding Artifact Address Primary Y Coordinate']), lon: Number(r['Geocoding Artifact Address Primary X Coordinate']) }))
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.lat !== 0)
    const healthCenters = new PointIndex(hrsa)

    if (zcta.size < 30_000) throw new Error(`Gazetteer has only ${zcta.size} ZCTAs; format changed?`)
    const zip3s = [...new Set([...zcta.keys()].map(z => z.slice(0, 3)))].sort()
    const urgent = await allUrgentCares(zip3s)
    const urgentPoints = [...urgent.values()].map(z => zcta.get(z)).filter((p): p is Point => !!p)
    const urgentCares = new PointIndex(urgentPoints)
    console.log(`  ${urgent.size} urgent care sites (${urgentPoints.length} located), ${hrsa.length} health center sites`)

    const { rows: hospitals } = await db.query<{
      facility_id: string; state: string | null; county: string | null; zip_code: string | null; emergency_services: boolean | null; county_fips: string | null
    }>(`SELECT h.facility_id, h.state, h.county, h.zip_code, h.emergency_services, c.county_fips
        FROM hospitals h LEFT JOIN hospital_context c USING (facility_id)`)
    const located = hospitals.map(h => ({ ...h, point: zcta.get(zip5(h.zip_code) ?? '') ?? null }))
    const eds = new PointIndex(located.filter(h => h.emergency_services && h.point).map(h => ({ ...h.point!, id: h.facility_id })))

    const rows = located.map(h => {
      const county = h.county_fips ? chrByFips.get(h.county_fips) : h.state && h.county ? chrByName.get(countyKey(h.state, h.county)) ?? undefined : undefined
      const fips = h.county_fips ?? county?.fips ?? null
      const g = fips ? gvByFips.get(fips) : undefined
      let local: (number | null)[] = [null, null, null, null, null]
      if (h.point) {
        const near = areas.within(h.point, LOCAL_MILES)
        const nearIncome = areas.within(h.point, INCOME_MILES).filter(a => a.income !== null && a.pop > 0)
        const incPop = nearIncome.reduce((s, a) => s + a.pop, 0)
        local = [
          near.reduce((s, a) => s + a.pop, 0),
          incPop > 0 ? nearIncome.reduce((s, a) => s + a.pop * a.income!, 0) / incPop : null,
          urgentCares.within(h.point, LOCAL_MILES).length,
          healthCenters.within(h.point, LOCAL_MILES).length,
          eds.within(h.point, LOCAL_MILES).filter(e => e.id !== h.facility_id).length,
        ]
      }
      return [h.facility_id, fips, county?.pcp ?? null, county?.otherPc ?? null, county?.preventable ?? null,
        toNumber(g?.ER_VISITS_PER_1000_BENES), toNumber(g?.EM_EVNTS_PER_1000_BENES), ...local]
    })

    const sources = { chr: chrYear, gv: gv.year, acs: `${acsYear} 5-year`, zcta: gazYear, nppes: month, hrsa: month, miles: LOCAL_MILES }
    const col = (i: number) => rows.map(r => r[i])
    await db.query('BEGIN')
    await db.query('DELETE FROM hospital_access')
    await db.query(
      `INSERT INTO hospital_access (facility_id, county_fips, county_pcp_per_100k, county_other_pc_per_100k,
                                    county_preventable_stays, county_er_visits_per_1000, county_em_visits_per_1000,
                                    local_population, local_income, urgent_care_sites, health_center_sites, other_eds, sources)
       SELECT *, $13::jsonb FROM unnest($1::text[], $2::text[], $3::float8[], $4::float8[], $5::float8[], $6::float8[],
                                        $7::float8[], $8::float8[], $9::float8[], $10::int[], $11::int[], $12::int[])`,
      [...Array.from({ length: 12 }, (_, i) => col(i)), JSON.stringify(sources)]
    )
    await db.query(
      `INSERT INTO source_loads (source, version, row_count) VALUES ($1, $2, $3)
       ON CONFLICT (source, version) DO UPDATE SET row_count = EXCLUDED.row_count, loaded_at = now()`,
      [SOURCE, version, rows.length]
    )
    await db.query('COMMIT')
    console.log(`+ hospital access (${version}): ${rows.length} hospitals`)

    const { rows: coverage } = await db.query(`
      SELECT count(*) AS hospitals, count(county_pcp_per_100k) AS pcp, count(county_preventable_stays) AS preventable,
             count(county_er_visits_per_1000) AS county_er, count(local_population) AS located, count(local_income) AS income,
             round(avg(urgent_care_sites), 1) AS avg_urgent, round(avg(health_center_sites), 1) AS avg_fqhc
      FROM hospital_access`)
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
