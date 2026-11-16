import fs from 'fs'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { miles } from '../src/ingest/access'
import { nearbyHospitals, originFromPoint, originFromZip } from '../src/services/nearby'

// The nearby SQL against every real migration in PGlite. Three Boston-area
// ZIPs, one in Worcester (~40 miles out) and one in New York (~190).
const MIGRATIONS = path.join(__dirname, '../migrations')
let db: PGlite

const ZIPS: [string, number, number][] = [
  ['02138', 42.3800, -71.1340], ['02115', 42.3420, -71.0920], ['02139', 42.3640, -71.1040],
  ['01608', 42.2620, -71.8020], ['10001', 40.7500, -73.9970],
]
// [id, zip, overall score, groups]; H5 has no score, H6 a ZIP+4.
const HOSPITALS: [string, string, number | null, number | null][] = [
  ['H1', '02115', 0.8, 5], ['H2', '02138', -0.4, 5], ['H3', '02139', 1.5, 3],
  ['H4', '01608', 0.2, 5], ['H5', '02139', null, null], ['H6', '10001-1234', -1.0, 5],
]

beforeAll(async () => {
  db = new PGlite()
  for (const file of fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'))
  }
  for (const [zip, lat, lon] of ZIPS) await db.query('INSERT INTO zip_points VALUES ($1, $2, $3)', [zip, lat, lon])
  await db.exec(`INSERT INTO analysis_runs (id, inputs) VALUES (1, '{}')`)
  for (const [id, zip, score, groups] of HOSPITALS) {
    await db.query('INSERT INTO hospitals (facility_id, name, state, zip_code) VALUES ($1, $2, $3, $4)', [id, `Hospital ${id}`, 'MA', zip])
    if (score === null) continue
    await db.query(
      `INSERT INTO analysis_hospital_scores (run_id, scope, facility_id, state, measures, groups, score, score_se, verdict, national_rank, state_rank)
       VALUES (1, 'overall', $1, 'MA', 20, $2, $3, 0.2, 'as_expected', 1, 1)`,
      [id, groups, score]
    )
  }
})

afterAll(async () => {
  await db.close()
})

describe('nearby hospitals', () => {
  it('finds ZIPs exactly, or by their 3-digit area', async () => {
    expect(await originFromZip('02138', db)).toMatchObject({ lat: 42.38, approximate: false })
    const area = await originFromZip('02199', db)
    expect(area?.approximate).toBe(true)
    expect(area?.lat).toBeCloseTo((42.38 + 42.342 + 42.364) / 3, 6)
    expect(await originFromZip('99999', db)).toBeNull()
  })

  it('names the nearest ZIP for a point', async () => {
    expect((await originFromPoint(42.343, -71.09, db))?.zip).toBe('02115')
    expect(await originFromPoint(0, 0, db)).toBeNull()
  })

  it('lists hospitals in the radius, best first, unscored last, with haversine miles', async () => {
    const origin = (await originFromZip('02138', db))!
    const rows = await nearbyHospitals(origin, 25, 'overall', db)
    expect(rows.map(r => r.id)).toEqual(['H3', 'H1', 'H2', 'H5'])
    expect(rows[0]).toMatchObject({ score: 1.5, overallGroups: 3, verdict: 'as_expected' })
    expect(rows[3]).toMatchObject({ score: null, overallGroups: null })
    const h1 = rows.find(r => r.id === 'H1')!
    expect(h1.miles).toBeCloseTo(miles({ lat: 42.38, lon: -71.134 }, { lat: 42.342, lon: -71.092 }), 1)

    expect((await nearbyHospitals(origin, 50, 'overall', db)).map(r => r.id)).toContain('H4')
    // ZIP+4 still matches its five-digit ZIP.
    expect((await nearbyHospitals(origin, 100, 'overall', db)).map(r => r.id)).not.toContain('H6')
    const ny = (await originFromZip('10001', db))!
    expect((await nearbyHospitals(ny, 5, 'overall', db)).map(r => r.id)).toEqual(['H6'])
  })
})
