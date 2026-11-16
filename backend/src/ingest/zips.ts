import { Client } from 'pg'
import { requireEnv } from '../db/env'
import { firstExisting, GAZETTEER_URL, gazetteer, unzipFirst } from './access'
import { get } from './context'

// ZIP code (ZCTA) points from the Census Gazetteer into zip_points, which
// locates hospitals and visitors for the "near you" search. The Gazetteer is
// yearly; skipped when that year's file is already loaded.
//
//   npm run ingest:zips --workspace=backend            # only if a new year is out
//   npm run ingest:zips --workspace=backend -- --force # reload regardless

const SOURCE = 'zip_points'
const force = process.argv.includes('--force')

async function main() {
  const year = new Date().getUTCFullYear()
  const [gazYear, url] = await firstExisting([year, year - 1, year - 2].map(y => [y, GAZETTEER_URL(y)] as [number, string]))
  const version = `ZCTA ${gazYear}`

  const db = new Client({ connectionString: requireEnv('DATABASE_URL_UNPOOLED') })
  await db.connect()
  try {
    const { rowCount } = await db.query('SELECT 1 FROM source_loads WHERE source = $1 AND version = $2', [SOURCE, version])
    if (rowCount && !force) {
      console.log(`= ZIP points (${version}): already loaded`)
      return
    }
    const zcta = [...gazetteer(await unzipFirst(Buffer.from(await get(url, 'arraybuffer'))))]
      .filter(([zip, p]) => /^\d{5}$/.test(zip) && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    if (zcta.length < 30_000) throw new Error(`Gazetteer has only ${zcta.length} ZCTAs; format changed?`)

    await db.query('BEGIN')
    await db.query('DELETE FROM zip_points')
    await db.query(
      'INSERT INTO zip_points (zip, lat, lon) SELECT * FROM unnest($1::text[], $2::float8[], $3::float8[])',
      [zcta.map(z => z[0]), zcta.map(z => z[1].lat), zcta.map(z => z[1].lon)]
    )
    await db.query(
      `INSERT INTO source_loads (source, version, row_count) VALUES ($1, $2, $3)
       ON CONFLICT (source, version) DO UPDATE SET row_count = EXCLUDED.row_count, loaded_at = now()`,
      [SOURCE, version, zcta.length]
    )
    await db.query('COMMIT')
    const { rows: [c] } = await db.query(
      'SELECT count(*)::int AS hospitals, count(p.facility_id)::int AS located FROM hospitals h LEFT JOIN hospital_points p USING (facility_id)'
    )
    console.log(`+ ZIP points (${version}): ${zcta.length} ZIPs; ${c.located} of ${c.hospitals} hospitals located`)
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
