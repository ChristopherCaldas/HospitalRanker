import axios from 'axios'
import { parse } from 'csv-parse/sync'
import { Client } from 'pg'
import { requireEnv } from '../db/env'
import { toDate, toText } from './parse'
import { withRetry } from './retry'
import { COST_FIELDS, costReportFiles, costRow, get, latestReports } from './context'

// Change over time, for the movers analysis:
//   - every yearly Hospital Provider Cost Report since FIRST_YEAR
//     (hospital_finance_history), so finances and staffing can be compared
//     between two measurement periods;
//   - CMS Hospital Change of Ownership records (hospital_ownership_changes).
// Skipped when the set of files was already loaded.
//
//   npm run ingest:changes --workspace=backend            # only if something changed
//   npm run ingest:changes --workspace=backend -- --force # reload regardless

const SOURCE = 'hospital_changes'
const FIRST_YEAR = 2017
const CATALOG = 'https://data.cms.gov/data.json'
const force = process.argv.includes('--force')

export interface OwnershipChange {
  buyerCcn: string | null
  sellerCcn: string | null
  effectiveDate: string
  chowType: string | null
  buyerName: string | null
  sellerName: string | null
}

const ccnOf = (v: string | undefined) => {
  const t = toText(v)
  return t ? t.padStart(6, '0') : null
}

export function ownershipChanges(rows: Record<string, string>[]): OwnershipChange[] {
  return rows
    .map(r => ({
      buyerCcn: ccnOf(r['CCN - BUYER']),
      sellerCcn: ccnOf(r['CCN - SELLER']),
      effectiveDate: toDate(r['EFFECTIVE DATE'])!,
      chowType: toText(r['CHOW TYPE TEXT']),
      buyerName: toText(r['ORGANIZATION NAME - BUYER']),
      sellerName: toText(r['ORGANIZATION NAME - SELLER']),
    }))
    .filter(r => r.effectiveDate && (r.buyerCcn || r.sellerCcn))
}

async function findChow(): Promise<{ title: string; url: string }> {
  const { data } = await withRetry('cms catalog', () => axios.get(CATALOG, { timeout: 120_000 }))
  const entry = (data.dataset as { title: string; distribution?: { downloadURL?: string; mediaType?: string }[] }[])
    .filter(d => /^Hospital Change of Ownership : \d{4}/.test(d.title))
    .sort((a, b) => b.title.localeCompare(a.title))[0]
  const url = entry?.distribution?.find(x => x.mediaType === 'text/csv')?.downloadURL
  if (!entry || !url) throw new Error('no Hospital Change of Ownership file in the CMS catalog')
  return { title: entry.title, url }
}

async function main() {
  const [costs, chow] = await Promise.all([costReportFiles(), findChow()])
  const years = costs.filter(c => c.year >= FIRST_YEAR)
  const version = `cost ${years.map(c => c.year).join(',')} (${years[0].title.replace(/^.*: /, '')}) | ${chow.title.replace('Hospital Change of Ownership : ', 'CHOW ')}`
  const db = new Client({ connectionString: requireEnv('DATABASE_URL_UNPOOLED') })
  await db.connect()
  try {
    const { rowCount } = await db.query('SELECT 1 FROM source_loads WHERE source = $1 AND version = $2', [SOURCE, version])
    if (rowCount && !force) {
      console.log(`= hospital changes (${version}): already loaded`)
      return
    }
    const { rows: known } = await db.query<{ facility_id: string }>('SELECT facility_id FROM hospitals')
    const hospitals = new Set(known.map(r => r.facility_id))

    // One file at a time (each is a full year for every hospital).
    const byYear = new Map<number, ReturnType<typeof latestReports>>()
    for (const c of years) {
      const rows = (parse(await get(c.url), { columns: true, bom: true, relax_column_count: true }) as Record<string, string>[]).map(costRow)
      byYear.set(c.year, latestReports(rows))
      console.log(`  cost report ${c.year}: ${rows.length} rows`)
    }
    const changes = ownershipChanges(parse(await get(chow.url), { columns: true, bom: true }) as Record<string, string>[])

    await db.query('BEGIN')
    await db.query('DELETE FROM hospital_finance_history')
    const fcols = Object.values(COST_FIELDS)
    let financeRows = 0
    for (const [year, reports] of byYear) {
      const fin = [...reports.values()].filter(r => hospitals.has(r.facilityId))
      financeRows += fin.length
      await db.query(
        `INSERT INTO hospital_finance_history (file_year, facility_id, fiscal_year_begin, fiscal_year_end, ${fcols.join(', ')})
         SELECT $1, * FROM unnest($2::text[], $3::date[], $4::date[], ${fcols.map((c, i) => `$${i + 5}::${c === 'beds' ? 'integer' : 'float8'}[]`).join(', ')})`,
        [year, fin.map(r => r.facilityId), fin.map(r => r.fiscalYearBegin), fin.map(r => r.fiscalYearEnd),
          ...fcols.map(c => fin.map(r => (c === 'beds' && r.values[c] !== null ? Math.round(r.values[c]!) : r.values[c])))]
      )
    }
    await db.query('DELETE FROM hospital_ownership_changes')
    const col = <K extends keyof OwnershipChange>(k: K) => changes.map(c => c[k])
    await db.query(
      `INSERT INTO hospital_ownership_changes (buyer_ccn, seller_ccn, effective_date, chow_type, buyer_name, seller_name)
       SELECT * FROM unnest($1::text[], $2::text[], $3::date[], $4::text[], $5::text[], $6::text[])`,
      [col('buyerCcn'), col('sellerCcn'), col('effectiveDate'), col('chowType'), col('buyerName'), col('sellerName')]
    )
    await db.query(
      `INSERT INTO source_loads (source, version, row_count) VALUES ($1, $2, $3)
       ON CONFLICT (source, version) DO UPDATE SET row_count = EXCLUDED.row_count, loaded_at = now()`,
      [SOURCE, version, financeRows + changes.length]
    )
    await db.query('COMMIT')
    console.log(`+ hospital changes (${version}): ${financeRows} yearly cost reports, ${changes.length} ownership changes`)
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
