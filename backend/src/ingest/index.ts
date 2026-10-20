import axios from 'axios'
import { parse } from 'csv-parse'
import { Client } from 'pg'
import { requireEnv } from '../db/env'
import { CsvRow, HOSPITAL_INFO_DATASET, MEASURE_DATASETS } from './datasets'
import { toBool, toInt, toText } from './parse'
import { withRetry } from './retry'
import { insertScores } from './store'

// Release-aware CMS ingestion. For each dataset, asks the CMS metastore for the
// current CSV; if that CSV was already ingested it does nothing, otherwise it
// downloads it and stores the release in one transaction.
//
//   npm run ingest --workspace=backend            # only new releases
//   npm run ingest --workspace=backend -- --force # re-ingest current releases

const METASTORE = 'https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items'
const force = process.argv.includes('--force')

interface DatasetMeta {
  id: string
  title: string
  downloadUrl: string
  modified: string | null
  released: string | null
}

async function fetchMeta(datasetId: string): Promise<DatasetMeta> {
  return withRetry(`metastore ${datasetId}`, async () => {
    const { data } = await axios.get(`${METASTORE}/${datasetId}`, { timeout: 30_000 })
    // On outages CMS answers 200 with an HTML error page.
    const downloadUrl = data?.distribution?.[0]?.downloadURL
    if (typeof downloadUrl !== 'string') throw new Error('metastore response has no downloadURL')
    return { id: datasetId, title: data.title, downloadUrl, modified: data.modified ?? null, released: data.released ?? null }
  })
}

async function downloadCsv(meta: DatasetMeta, keep: (row: CsvRow) => boolean): Promise<CsvRow[]> {
  return withRetry(`download ${meta.id}`, async () => {
    const res = await axios.get(meta.downloadUrl, { responseType: 'stream', timeout: 300_000 })
    const rows: CsvRow[] = []
    const parser = res.data.pipe(parse({ columns: true, bom: true, skip_empty_lines: true }))
    for await (const row of parser) if (keep(row)) rows.push(row)
    if (rows.length === 0) throw new Error('CSV contained no matching rows')
    return rows
  })
}

// Returns the release id to ingest into, or null if this CSV is already
// complete for every measure we currently want from it.
async function claimRelease(db: Client, meta: DatasetMeta, measureIds: string[]): Promise<number | null> {
  const existing = await db.query<{ id: number; status: string; measure_ids: string[] }>(
    'SELECT id, status, measure_ids FROM cms_releases WHERE download_url = $1',
    [meta.downloadUrl]
  )
  const prior = existing.rows[0]
  const covered = prior && measureIds.every(id => prior.measure_ids.includes(id))
  if (prior?.status === 'complete' && covered && !force) return null

  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO cms_releases (dataset_id, title, download_url, modified, released)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (download_url) DO UPDATE
       SET status = 'ingesting', error = NULL, started_at = now(), completed_at = NULL
     RETURNING id`,
    [meta.id, meta.title, meta.downloadUrl, meta.modified, meta.released]
  )
  return rows[0].id
}

async function upsertHospitals(db: Client, rows: CsvRow[]): Promise<void> {
  const col = (name: string) => rows.map(r => toText(r[name]))
  await db.query(
    `INSERT INTO hospitals (facility_id, name, address, city, state, zip_code, county, phone,
                            hospital_type, ownership, emergency_services, overall_rating, updated_at)
     SELECT *, now() FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                                 $7::text[], $8::text[], $9::text[], $10::text[], $11::boolean[], $12::smallint[])
     ON CONFLICT (facility_id) DO UPDATE SET
       name = EXCLUDED.name, address = EXCLUDED.address, city = EXCLUDED.city, state = EXCLUDED.state,
       zip_code = EXCLUDED.zip_code, county = EXCLUDED.county, phone = EXCLUDED.phone,
       hospital_type = EXCLUDED.hospital_type, ownership = EXCLUDED.ownership,
       emergency_services = EXCLUDED.emergency_services, overall_rating = EXCLUDED.overall_rating,
       updated_at = now()`,
    [
      col('Facility ID'), col('Facility Name'), col('Address'), col('City/Town'), col('State'),
      col('ZIP Code'), col('County/Parish'), col('Telephone Number'), col('Hospital Type'),
      col('Hospital Ownership'), rows.map(r => toBool(r['Emergency Services'])),
      rows.map(r => toInt(r['Hospital overall rating'])),
    ]
  )
}

async function ingestDataset(db: Client, datasetId: string, measureIds: string[]): Promise<void> {
  const meta = await fetchMeta(datasetId)
  const label = `${meta.title} (${datasetId}, released ${meta.released})`
  const releaseId = await claimRelease(db, meta, measureIds)
  if (releaseId === null) {
    console.log(`= ${label}: already ingested`)
    return
  }

  try {
    const isHospitalInfo = datasetId === HOSPITAL_INFO_DATASET
    const spec = MEASURE_DATASETS[datasetId]
    if (!isHospitalInfo && !spec) throw new Error(`No CSV mapping for dataset ${datasetId}`)

    const wanted = new Set(measureIds)
    const rows = await downloadCsv(meta, row => isHospitalInfo || wanted.has(row[spec.measureIdColumn]?.trim()))

    await db.query('BEGIN')
    if (isHospitalInfo) await upsertHospitals(db, rows)
    else await insertScores(db, releaseId, rows, rows.map(spec.toScore))
    await db.query(
      `UPDATE cms_releases SET status = 'complete', row_count = $2, measure_ids = $3, completed_at = now()
       WHERE id = $1`,
      [releaseId, rows.length, [...measureIds].sort()]
    )
    await db.query('COMMIT')
    console.log(`+ ${label}: ingested ${rows.length} rows`)
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    await db.query(`UPDATE cms_releases SET status = 'failed', error = $2 WHERE id = $1`, [
      releaseId,
      (err as Error).message,
    ])
    throw err
  }
}

async function printCoverage(db: Client): Promise<void> {
  const { rows } = await db.query(`
    SELECT m.category, s.measure_id, s.released, count(*) AS hospitals,
           count(s.score) AS with_score, min(s.start_date) AS period_start, max(s.end_date) AS period_end
    FROM latest_measure_scores s JOIN measures m USING (measure_id)
    GROUP BY m.category, s.measure_id, s.released ORDER BY m.category`)
  console.table(rows)
  for (const r of rows) {
    if (Number(r.with_score) === 0) console.warn(`! ${r.measure_id}: latest release has no scores (suppressed by CMS?)`)
  }
}

async function main() {
  const db = new Client({ connectionString: requireEnv('DATABASE_URL_UNPOOLED') })
  await db.connect()

  try {
    const { rows: measures } = await db.query<{ measure_id: string; dataset_id: string }>(
      'SELECT measure_id, dataset_id FROM measures'
    )
    const byDataset = new Map<string, string[]>()
    for (const m of measures) byDataset.set(m.dataset_id, [...(byDataset.get(m.dataset_id) ?? []), m.measure_id])

    // Hospitals first so measure rows pick up full hospital attributes.
    const failures: string[] = []
    for (const [datasetId, measureIds] of [[HOSPITAL_INFO_DATASET, []] as [string, string[]], ...byDataset]) {
      try {
        await ingestDataset(db, datasetId, measureIds)
      } catch (err) {
        console.error(`! ${datasetId}: ${(err as Error).message}`)
        failures.push(datasetId)
      }
    }

    await printCoverage(db)
    if (failures.length) {
      console.error(`Failed datasets: ${failures.join(', ')}`)
      process.exitCode = 1
    }
  } finally {
    await db.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
