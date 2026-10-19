import axios from 'axios'
import { Client } from 'pg'
import { requireEnv } from '../db/env'
import { toInt, toNumber } from './parse'
import { withRetry } from './retry'

// Medicare spending per beneficiary by state, from CMS's Geographic Variation
// PUF (published yearly). The data.cms.gov catalog says which release is
// current; a run is skipped when that release was already loaded.
//
//   npm run ingest:spend --workspace=backend            # only a new release
//   npm run ingest:spend --workspace=backend -- --force # reload regardless

const CATALOG = 'https://data.cms.gov/data.json'
const TITLE = /^Medicare Geographic Variation - by National, State & County/
const SOURCE = 'cms_medicare_gv'
const force = process.argv.includes('--force')

// API column -> our column.
const FIELDS = {
  BENES_TOTAL_CNT: 'benes_total',
  BENES_OM_CNT: 'benes_ffs',
  MA_PRTCPTN_RATE: 'ma_participation_rate',
  BENE_AVG_AGE: 'avg_age',
  BENE_DUAL_PCT: 'dual_eligible_pct',
  TOT_MDCR_PYMT_PC: 'total_pymt_pc',
  TOT_MDCR_STDZD_PYMT_PC: 'total_stdzd_pymt_pc',
  IP_MDCR_PYMT_PC: 'ip_pymt_pc',
  IP_MDCR_STDZD_PYMT_PC: 'ip_stdzd_pymt_pc',
  ACUTE_HOSP_READMSN_PCT: 'readmission_pct',
  ER_VISITS_PER_1000_BENES: 'er_visits_per_1000',
} as const

const INTEGER_COLUMNS = new Set(['benes_total', 'benes_ffs'])

// The PUF also has 'Territory' (pooled small territories) and 'ZZ' (unknown).
const isState = (code: string) => /^[A-Z]{2}$/.test(code) && code !== 'ZZ'

async function findRelease(): Promise<{ apiUrl: string; version: string }> {
  return withRetry('cms catalog', async () => {
    const { data } = await axios.get(CATALOG, { timeout: 120_000 })
    const entry = data?.dataset?.find((d: { title: string }) => TITLE.test(d.title))
    // `identifier` is the dataset's stable data-viewer URL, which always serves the latest release.
    const apiUrl = entry?.identifier?.replace(/\/data-viewer$/, '/data')
    if (!apiUrl || !entry.modified) throw new Error('Geographic Variation dataset not found in catalog')
    return { apiUrl, version: `${entry.modified} ${entry.title}` }
  })
}

async function fetchRows(apiUrl: string): Promise<Record<string, string>[]> {
  return withRetry('medicare gv rows', async () => {
    const { data } = await axios.get(apiUrl, {
      params: {
        'filter[BENE_GEO_LVL]': 'State',
        'filter[BENE_AGE_LVL]': 'All',
        column: ['YEAR', 'BENE_GEO_DESC', ...Object.keys(FIELDS)].join(','),
        size: 5000,
      },
      timeout: 120_000,
    })
    if (!Array.isArray(data) || data.length === 0) throw new Error('Geographic Variation API returned no rows')
    if (data.length >= 5000) throw new Error('Geographic Variation API returned a full page; add pagination')
    return data
  })
}

async function main() {
  const release = await findRelease()
  const db = new Client({ connectionString: requireEnv('DATABASE_URL_UNPOOLED') })
  await db.connect()

  try {
    const { rowCount } = await db.query('SELECT 1 FROM source_loads WHERE source = $1 AND version = $2', [
      SOURCE,
      release.version,
    ])
    if (rowCount && !force) {
      console.log(`= Medicare GV (${release.version}): already loaded`)
      return
    }

    const rows = (await fetchRows(release.apiUrl)).filter(r => isState(r.BENE_GEO_DESC))
    const entries = Object.entries(FIELDS)
    const columns = entries.map(([, col]) => col)
    const values = entries.map(([field, col]) =>
      rows.map(r => (INTEGER_COLUMNS.has(col) ? toInt(r[field]) : toNumber(r[field])))
    )
    const casts = columns.map((col, i) => `$${i + 3}::${INTEGER_COLUMNS.has(col) ? 'integer' : 'numeric'}[]`)

    await db.query('BEGIN')
    await db.query(
      `INSERT INTO state_medicare_spend (state, year, ${columns.join(', ')})
       SELECT * FROM unnest($1::text[], $2::smallint[], ${casts.join(', ')})
       ON CONFLICT (state, year) DO UPDATE SET ${columns.map(c => `${c} = EXCLUDED.${c}`).join(', ')}`,
      [rows.map(r => r.BENE_GEO_DESC), rows.map(r => toInt(r.YEAR)), ...values]
    )
    await db.query(
      `INSERT INTO source_loads (source, version, row_count) VALUES ($1, $2, $3)
       ON CONFLICT (source, version) DO UPDATE SET row_count = EXCLUDED.row_count, loaded_at = now()`,
      [SOURCE, release.version, rows.length]
    )
    await db.query('COMMIT')
    console.log(`+ Medicare GV (${release.version}): loaded ${rows.length} state-years`)

    const { rows: summary } = await db.query(`
      SELECT min(year) AS first_year, max(year) AS last_year, count(DISTINCT state) AS states,
             round(min(total_stdzd_pymt_pc)) AS min_stdzd_pc, round(max(total_stdzd_pymt_pc)) AS max_stdzd_pc,
             round(min(ma_participation_rate), 2) AS min_ma, round(max(ma_participation_rate), 2) AS max_ma
      FROM state_medicare_spend WHERE year = (SELECT max(year) FROM state_medicare_spend)
         OR year = (SELECT min(year) FROM state_medicare_spend)
      GROUP BY year = (SELECT max(year) FROM state_medicare_spend) ORDER BY 1`)
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
