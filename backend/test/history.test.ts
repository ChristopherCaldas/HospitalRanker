import fs from 'fs'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { ARCHIVE_FILES, MEASURE_ALIASES, yearEndSnapshots } from '../src/ingest/archive'

describe('yearEndSnapshots', () => {
  const entry = (type: string, date: string) => ({ type, date, url: `/files/hospitals_${date}.zip` })

  it('keeps the last regular snapshot of each finished year from 2019', () => {
    const picked = yearEndSnapshots(
      [
        entry('theme', '2018-10-31'),
        entry('theme', '2019-04-04'),
        entry('theme', '2019-10-31'),
        entry('annual_theme', '2019-12-31'),
        entry('theme', '2025-11-26'),
        entry('theme', '2025-08-14'),
        entry('theme', '2026-05-13'),
      ],
      new Date('2026-10-19T00:00:00Z')
    )
    expect(picked.map(s => s.date)).toEqual(['2019-10-31', '2025-11-26'])
    expect(picked[0].url).toBe('https://data.cms.gov/files/hospitals_2019-10-31.zip')
  })
})

describe('ARCHIVE_FILES', () => {
  it('finds the hospital-level CSV under every naming scheme CMS has used', () => {
    const pattern = ARCHIVE_FILES['ynj2-r877']
    expect(pattern.test('Complications and Deaths - Hospital.csv')).toBe(true) // 2019
    expect(pattern.test('ynj2-r877.csv')).toBe(true) // 2020
    expect(pattern.test('hospitals_10_2022/Complications_and_Deaths-Hospital.csv')).toBe(true)
    expect(pattern.test('Complications_and_Deaths-State.csv')).toBe(false)
    expect(ARCHIVE_FILES['dgck-syfz'].test('PCH_HCAHPS_HOSPITAL.csv')).toBe(false)
    expect(MEASURE_ALIASES.PSI_90_SAFETY).toBe('PSI_90')
  })
})

describe('measure_score_history', () => {
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
    const dir = path.join(__dirname, '../migrations')
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      await db.exec(fs.readFileSync(path.join(dir, file), 'utf8'))
    }
    await db.exec(`
      INSERT INTO hospitals (facility_id, name, state) VALUES ('H1', 'Hospital 1', 'AL');
      INSERT INTO cms_releases (id, dataset_id, title, download_url, released, status, source) VALUES
        (1, 'ynj2-r877', 'a', 'https://x.test/2023.zip#c.csv', '2023-11-06', 'complete', 'archive'),
        (2, 'ynj2-r877', 'b', 'https://x.test/2024.zip#c.csv', '2024-10-30', 'complete', 'archive'),
        (3, 'ynj2-r877', 'c', 'https://x.test/live.csv',      '2026-09-30', 'complete', 'live');
      INSERT INTO measure_scores (release_id, facility_id, measure_id, score, start_date, end_date) VALUES
        (1, 'H1', 'PSI_90', 1.10, '2021-07-01', '2023-06-30'),
        -- the same period republished with a correction: the newer release wins
        (2, 'H1', 'PSI_90', 1.20, '2021-07-01', '2023-06-30'),
        (3, 'H1', 'PSI_90', 1.50, '2022-07-01', '2024-06-30'),
        (2, 'H1', 'MORT_30_AMI', NULL, '2020-07-01', '2023-06-30');
    `)
  })

  afterAll(async () => {
    await db.close()
  })

  it('has one score per period, newest release first, and skips missing scores', async () => {
    const { rows } = await db.query<{ measure_id: string; score: string; source: string }>(
      `SELECT measure_id, score::text, source FROM measure_score_history WHERE facility_id = 'H1' ORDER BY end_date`
    )
    expect(rows).toEqual([
      { measure_id: 'PSI_90', score: '1.20', source: 'archive' },
      { measure_id: 'PSI_90', score: '1.50', source: 'live' },
    ])
  })

  it('leaves the latest-release view on the live release', async () => {
    const { rows } = await db.query<{ release_id: number }>('SELECT DISTINCT release_id FROM latest_measure_scores')
    expect(rows).toEqual([{ release_id: 3 }])
  })
})
