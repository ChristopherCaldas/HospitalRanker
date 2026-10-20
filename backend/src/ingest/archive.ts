import axios from 'axios'
import { parse } from 'csv-parse'
import { Client } from 'pg'
import yauzl from 'yauzl'
import { requireEnv } from '../db/env'
import { CsvRow, MEASURE_DATASETS } from './datasets'
import { withRetry } from './retry'
import { insertScores } from './store'

// Backfills score history from CMS's archived hospital snapshots (one zip of
// every hospital CSV per data refresh, back to 2019). Takes the last snapshot
// of each finished year, so trends are yearly. Each CSV inside a zip is stored
// as its own release (source 'archive'); snapshots already stored are skipped.
//
//   npm run ingest:archive --workspace=backend

const ARCHIVE_INDEX = 'https://data.cms.gov/provider-data/api/1/archive/aggregate/theme/hospitals/relative'
const ARCHIVE_HOST = 'https://data.cms.gov'
const FIRST_YEAR = 2019

// Which CSV in a snapshot holds each dataset. Names changed over the years
// ("Complications and Deaths - Hospital.csv" -> "Complications_and_Deaths-Hospital.csv"),
// and the 2020 snapshots name each file by its dataset ID instead.
export const ARCHIVE_FILES: Record<string, RegExp> = {
  'yv7e-xc69': /(^|\/)(Timely.and.Effective.Care.?-.?Hospital|yv7e-xc69)\.csv$/i,
  'ynj2-r877': /(^|\/)(Complications.and.Deaths.?-.?Hospital|ynj2-r877)\.csv$/i,
  '632h-zaca': /(^|\/)(Unplanned.Hospital.Visits.?-.?Hospital|632h-zaca)\.csv$/i,
  'dgck-syfz': /(^|\/)(HCAHPS.?-.?Hospital|dgck-syfz)\.csv$/i,
}

// Measure IDs CMS has since renamed.
export const MEASURE_ALIASES: Record<string, string> = { PSI_90_SAFETY: 'PSI_90' }

export interface Snapshot {
  date: string
  url: string
}

// The last regular snapshot of each finished year from FIRST_YEAR on.
export function yearEndSnapshots(entries: { type: string; date: string; url: string }[], today = new Date()): Snapshot[] {
  const byYear = new Map<number, Snapshot>()
  for (const e of entries) {
    const year = Number(e.date.slice(0, 4))
    if (e.type !== 'theme' || year < FIRST_YEAR || year >= today.getUTCFullYear()) continue
    const best = byYear.get(year)
    if (!best || e.date > best.date) byYear.set(year, { date: e.date, url: ARCHIVE_HOST + e.url })
  }
  return [...byYear.values()].sort((a, b) => a.date.localeCompare(b.date))
}

async function listSnapshots(): Promise<Snapshot[]> {
  return withRetry('archive index', async () => {
    const { data } = await axios.get(ARCHIVE_INDEX, { timeout: 30_000 })
    if (!Array.isArray(data?.data)) throw new Error('archive index has no data array')
    return yearEndSnapshots(data.data)
  })
}

async function download(url: string): Promise<Buffer> {
  return withRetry(`download ${url}`, async () => {
    const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 300_000 })
    const buf = Buffer.from(res.data)
    // Outages come back as HTML; a zip starts with "PK".
    if (buf.subarray(0, 2).toString() !== 'PK') throw new Error('response is not a zip file')
    return buf
  })
}

// Reads the wanted CSVs out of a zip, keeping only rows that pass `keep`.
async function readCsvs(zip: Buffer, wanted: Map<string, string>, keep: (datasetId: string, row: CsvRow) => boolean) {
  const out = new Map<string, { path: string; rows: CsvRow[] }>()
  const file = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(zip, { lazyEntries: true }, (err, f) => (err ? reject(err) : resolve(f)))
  )
  await new Promise<void>((resolve, reject) => {
    file.on('error', reject)
    file.on('end', resolve)
    file.on('entry', (entry: yauzl.Entry) => {
      const datasetId = wanted.get(entry.fileName)
      if (!datasetId) return file.readEntry()
      file.openReadStream(entry, async (err, stream) => {
        if (err) return reject(err)
        try {
          const rows: CsvRow[] = []
          for await (const row of stream.pipe(parse({ columns: true, bom: true, skip_empty_lines: true, relax_quotes: true }))) {
            if (keep(datasetId, row)) rows.push(row)
          }
          out.set(datasetId, { path: entry.fileName, rows })
          file.readEntry()
        } catch (e) {
          reject(e)
        }
      })
    })
    file.readEntry()
  })
  return out
}

async function main() {
  const db = new Client({ connectionString: requireEnv('DATABASE_URL_UNPOOLED') })
  await db.connect()
  try {
    const { rows: measures } = await db.query<{ measure_id: string; dataset_id: string }>(
      'SELECT measure_id, dataset_id FROM measures'
    )
    const wantedMeasures = new Map<string, Set<string>>()
    for (const m of measures) {
      if (!ARCHIVE_FILES[m.dataset_id]) continue
      wantedMeasures.set(m.dataset_id, (wantedMeasures.get(m.dataset_id) ?? new Set()).add(m.measure_id))
    }
    // Archive releases must stay older than each dataset's live release.
    const { rows: live } = await db.query<{ dataset_id: string; released: string }>(
      `SELECT dataset_id, to_char(min(released), 'YYYY-MM-DD') AS released
       FROM cms_releases WHERE source = 'live' AND status = 'complete' GROUP BY dataset_id`
    )
    const liveReleased = new Map(live.map(r => [r.dataset_id, r.released]))
    const { rows: known } = await db.query<{ facility_id: string }>('SELECT facility_id FROM hospitals')
    const hospitals = new Set(known.map(r => r.facility_id))
    const { rows: stored } = await db.query<{ download_url: string; dataset_id: string }>(
      `SELECT download_url, dataset_id FROM cms_releases WHERE source = 'archive' AND status = 'complete'`
    )
    const done = new Set(stored.map(r => `${r.download_url.split('#')[0]} ${r.dataset_id}`))

    for (const snap of await listSnapshots()) {
      const datasets = [...wantedMeasures.keys()].filter(d =>
        !done.has(`${snap.url} ${d}`) && (!liveReleased.get(d) || snap.date < liveReleased.get(d)!)
      )
      if (datasets.length === 0) {
        console.log(`= ${snap.date}: already stored`)
        continue
      }
      const zip = await download(snap.url)
      const names = await new Promise<string[]>((resolve, reject) =>
        yauzl.fromBuffer(zip, { lazyEntries: false }, (err, f) => {
          if (err) return reject(err)
          const list: string[] = []
          f.on('entry', (e: yauzl.Entry) => list.push(e.fileName)).on('end', () => resolve(list)).on('error', reject)
        })
      )
      const wanted = new Map<string, string>()
      for (const d of datasets) {
        const path = names.find(n => ARCHIVE_FILES[d].test(n))
        if (path) wanted.set(path, d)
        else console.warn(`! ${snap.date}: no CSV for ${d}`)
      }

      const csvs = await readCsvs(zip, wanted, (d, row) => {
        const spec = MEASURE_DATASETS[d]
        const raw = row[spec.measureIdColumn]?.trim()
        const id = MEASURE_ALIASES[raw] ?? raw
        // Closed hospitals have no current record; their history isn't shown.
        return wantedMeasures.get(d)!.has(id) && hospitals.has(row['Facility ID']?.trim())
      })

      await db.query('BEGIN')
      try {
        for (const [datasetId, { path, rows }] of csvs) {
          const spec = MEASURE_DATASETS[datasetId]
          const scores = rows.map(spec.toScore).map(s => ({ ...s, measure_id: MEASURE_ALIASES[s.measure_id] ?? s.measure_id }))
          const measureIds = [...new Set(scores.map(s => s.measure_id))].sort()
          const { rows: [release] } = await db.query<{ id: number }>(
            `INSERT INTO cms_releases (dataset_id, title, download_url, modified, released, source, status,
                                       row_count, measure_ids, completed_at)
             VALUES ($1, $2, $3, $4, $4, 'archive', 'complete', $5, $6, now())
             ON CONFLICT (download_url) DO UPDATE SET status = 'complete', row_count = EXCLUDED.row_count,
               measure_ids = EXCLUDED.measure_ids, completed_at = now()
             RETURNING id`,
            [datasetId, `Archive ${snap.date}: ${path.split('/').pop()}`, `${snap.url}#${path}`, snap.date, rows.length, measureIds]
          )
          await insertScores(db, release.id, rows, scores)
          console.log(`+ ${snap.date} ${datasetId}: ${rows.length} rows (${measureIds.join(', ')})`)
        }
        await db.query('COMMIT')
      } catch (err) {
        await db.query('ROLLBACK').catch(() => {})
        throw err
      }
    }
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
