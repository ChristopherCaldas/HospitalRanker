import axios from 'axios'
import { Client } from 'pg'
import { requireEnv } from '../db/env'
import { reportingPeriod, toInt, toNumber } from './parse'
import { withRetry } from './retry'

// Weekly CDC NHSN hospital respiratory data by jurisdiction. CDC revises past
// weeks, so each load upserts the full series (~22k rows); a run is skipped
// when the dataset's rowsUpdatedAt hasn't changed since the last load.
//
//   npm run ingest:strain --workspace=backend            # only if CDC updated
//   npm run ingest:strain --workspace=backend -- --force # reload regardless

const DATASET = 'ua7e-t2fy'
const SOURCE = 'cdc_nhsn_hrd'
const force = process.argv.includes('--force')

// Socrata field -> our column. Values arrive as strings like "59878.0".
const FIELDS = {
  numinptbedshosprep: 'hospitals_reporting',
  numinptbeds: 'inpatient_beds',
  numinptbedsocc: 'inpatient_beds_occupied',
  pctinptbedsocc: 'pct_inpatient_occupied',
  pctinptbedsoccperchosprep: 'pct_inpatient_coverage',
  numicubeds: 'icu_beds',
  numicubedsocc: 'icu_beds_occupied',
  pcticubedsocc: 'pct_icu_occupied',
  pcticubedsoccperchosprep: 'pct_icu_coverage',
  totalconfc19newadm: 'covid_admissions',
  totalconfflunewadm: 'flu_admissions',
  totalconfrsvnewadm: 'rsv_admissions',
  totalconfc19newadmperchosprep: 'pct_admissions_coverage',
} as const

const INTEGER_COLUMNS = new Set([
  'hospitals_reporting', 'inpatient_beds', 'inpatient_beds_occupied', 'icu_beds',
  'icu_beds_occupied', 'covid_admissions', 'flu_admissions', 'rsv_admissions',
])

async function fetchVersion(): Promise<string> {
  return withRetry('cdc metadata', async () => {
    const { data } = await axios.get(`https://data.cdc.gov/api/views/${DATASET}.json`, { timeout: 30_000 })
    if (typeof data?.rowsUpdatedAt !== 'number') throw new Error('metadata has no rowsUpdatedAt')
    return new Date(data.rowsUpdatedAt * 1000).toISOString()
  })
}

async function fetchRows(): Promise<Record<string, string>[]> {
  return withRetry('cdc rows', async () => {
    const { data } = await axios.get(`https://data.cdc.gov/resource/${DATASET}.json`, {
      params: {
        $select: ['weekendingdate', 'jurisdiction', ...Object.keys(FIELDS)].join(','),
        $order: 'weekendingdate, jurisdiction',
        $limit: 200_000,
      },
      timeout: 120_000,
    })
    if (!Array.isArray(data) || data.length === 0) throw new Error('CDC returned no rows')
    return data
  })
}

async function main() {
  const version = await fetchVersion()
  const db = new Client({ connectionString: requireEnv('DATABASE_URL_UNPOOLED') })
  await db.connect()

  try {
    const { rowCount } = await db.query('SELECT 1 FROM source_loads WHERE source = $1 AND version = $2', [SOURCE, version])
    if (rowCount && !force) {
      console.log(`= CDC NHSN (updated ${version}): already loaded`)
      return
    }

    const rows = await fetchRows()
    const weeks = rows.map(r => r.weekendingdate.slice(0, 10))
    const entries = Object.entries(FIELDS)
    const columns = entries.map(([, col]) => col)
    const values = entries.map(([field, col]) =>
      rows.map(r => (INTEGER_COLUMNS.has(col) ? toInt(r[field]) : toNumber(r[field])))
    )
    const casts = columns.map((col, i) => `$${i + 4}::${INTEGER_COLUMNS.has(col) ? 'integer' : 'numeric'}[]`)

    await db.query('BEGIN')
    await db.query(
      `INSERT INTO state_weekly_strain (jurisdiction, week_ending, reporting_period, ${columns.join(', ')})
       SELECT * FROM unnest($1::text[], $2::date[], $3::text[], ${casts.join(', ')})
       ON CONFLICT (jurisdiction, week_ending) DO UPDATE SET
         reporting_period = EXCLUDED.reporting_period,
         ${columns.map(c => `${c} = EXCLUDED.${c}`).join(', ')}`,
      [rows.map(r => r.jurisdiction), weeks, weeks.map(reportingPeriod), ...values]
    )
    await db.query(
      `INSERT INTO source_loads (source, version, row_count) VALUES ($1, $2, $3)
       ON CONFLICT (source, version) DO UPDATE SET row_count = EXCLUDED.row_count, loaded_at = now()`,
      [SOURCE, version, rows.length]
    )
    await db.query('COMMIT')
    console.log(`+ CDC NHSN (updated ${version}): loaded ${rows.length} rows`)

    const { rows: summary } = await db.query(`
      SELECT reporting_period, min(week_ending)::text AS first_week, max(week_ending)::text AS last_week,
             count(*) FILTER (WHERE jurisdiction = 'USA') AS weeks,
             round(avg(pct_inpatient_coverage) FILTER (WHERE jurisdiction = 'USA'), 1) AS usa_coverage_pct,
             count(*) FILTER (WHERE pct_inpatient_occupied > 100) AS occupancy_over_100
      FROM state_weekly_strain GROUP BY reporting_period ORDER BY first_week`)
    console.table(summary)
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await db.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
