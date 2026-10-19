import fs from 'fs'
import path from 'path'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

// Runs every real migration against an in-process Postgres 18 (PGlite), seeds
// a small hand-built dataset, and checks the analysis views against an
// independent JavaScript implementation of the same statistics.

const MIGRATIONS = path.join(__dirname, '../migrations')
let db: PGlite

// Six states with three hospitals each (OP_18b, lower is better), plus one
// state with only two hospitals, which the correlations must leave out.
const STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO']
const HOSPITALS = [
  // [state, score (minutes), denominator]
  ['AL', 150, 100], ['AL', 170, 300], ['AL', 160, 200],
  ['AK', 120, 50], ['AK', 140, 150], ['AK', 130, 100],
  ['AZ', 200, 400], ['AZ', 190, 100], ['AZ', 210, 100],
  ['AR', 140, 100], ['AR', 150, 100], ['AR', 160, 100],
  ['CA', 220, 500], ['CA', 180, 100], ['CA', 230, 400],
  ['CO', 125, 200], ['CO', 135, 200], ['CO', 115, 100],
  ['CT', 300, 100], ['CT', 310, 100],
] as const
// Per state: in-window weekly occupancy values that should be used.
const OCCUPANCY: Record<string, number[]> = {
  AL: [70, 72, 74, 76], AK: [60, 62, 61, 63], AZ: [80, 82, 84, 78],
  AR: [68, 66, 70, 72], CA: [85, 87, 83, 89], CO: [64, 60, 62, 66], CT: [90, 90, 90, 90],
}
const SPEND_2024: Record<string, number> = { AL: 11000, AK: 9000, AZ: 12500, AR: 10500, CA: 13500, CO: 9500, CT: 14000 }
const DUAL: Record<string, number> = { AL: 0.22, AK: 0.18, AZ: 0.25, AR: 0.2, CA: 0.3, CO: 0.15, CT: 0.27 }
const WEEKS = ['2024-01-06', '2024-04-06', '2024-07-06', '2024-10-05']

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
function pearson(x: number[], y: number[]) {
  const mx = mean(x), my = mean(y)
  let sxy = 0, sxx = 0, syy = 0
  x.forEach((_, i) => { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2 })
  return sxy / Math.sqrt(sxx * syy)
}
const ranks = (xs: number[]) => xs.map(v => (xs.filter(u => u < v).length + 1 + xs.filter(u => u <= v).length) / 2)

beforeAll(async () => {
  db = new PGlite()
  for (const file of fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'))
  }

  await db.exec(`INSERT INTO cms_releases (id, dataset_id, title, download_url, released, status)
                 VALUES (1, 'yv7e-xc69', 'Timely', 'https://example.test/r1.csv', '2025-06-01', 'complete')`)
  for (const [i, [state, score, denominator]] of HOSPITALS.entries()) {
    const id = `H${i}`
    await db.query('INSERT INTO hospitals (facility_id, name, state) VALUES ($1, $2, $3)', [id, `Hospital ${i}`, state])
    await db.query(
      `INSERT INTO measure_scores (release_id, facility_id, measure_id, score, denominator, start_date, end_date)
       VALUES (1, $1, 'OP_18b', $2, $3, '2024-01-01', '2024-12-31')`,
      [id, score, denominator]
    )
  }
  for (const [state, occ] of Object.entries(OCCUPANCY)) {
    for (const [w, week] of WEEKS.entries()) {
      await db.query(
        `INSERT INTO state_weekly_strain (jurisdiction, week_ending, reporting_period, inpatient_beds,
           pct_inpatient_occupied, pct_inpatient_coverage, pct_icu_occupied, covid_admissions, flu_admissions,
           pct_admissions_coverage)
         VALUES ($1, $2, 'mandated_2020', 1000, $3, 95, $4, $5, $6, 95)`,
        [state, week, occ[w], occ[w] - 5, 10 + w, 5]
      )
    }
    // Noise the analysis must ignore: a low-coverage week, an impossible
    // occupancy, and a week outside the measure window.
    await db.query(`INSERT INTO state_weekly_strain (jurisdiction, week_ending, reporting_period, pct_inpatient_occupied, pct_inpatient_coverage)
                    VALUES ($1, '2024-07-13', 'voluntary_2024', 10, 30), ($1, '2024-08-03', 'voluntary_2024', 140, 95),
                           ($1, '2023-12-30', 'mandated_2020', 99, 95)`, [state])
    // 2024 overlaps the whole window; 2023 must get zero weight.
    await db.query(
      `INSERT INTO state_medicare_spend (state, year, total_stdzd_pymt_pc, ip_stdzd_pymt_pc, dual_eligible_pct, ma_participation_rate)
       VALUES ($1, 2024, $2, $3, $4, 0.4), ($1, 2023, 99999, 99999, 0.99, 0.4)`,
      [state, SPEND_2024[state], SPEND_2024[state] * 0.3, DUAL[state]]
    )
  }
})

afterAll(async () => {
  await db.close()
})

const expectedOutcome = (state: string) => {
  const rows = HOSPITALS.filter(h => h[0] === state)
  return rows.reduce((a, h) => a + h[1] * h[2], 0) / rows.reduce((a, h) => a + h[2], 0)
}

describe('analysis views', () => {
  it('weights state outcomes by case count', async () => {
    const { rows } = await db.query<{ state: string; outcome: string; hospitals: number }>(
      `SELECT state, outcome, hospitals FROM analysis_state_measure_live WHERE measure_id = 'OP_18b' ORDER BY state`
    )
    for (const r of rows) expect(Number(r.outcome)).toBeCloseTo(expectedOutcome(r.state), 9)
    expect(rows.find(r => r.state === 'CT')?.hospitals).toBe(2)
  })

  it('averages only in-window, well-covered, plausible strain weeks', async () => {
    const { rows } = await db.query<{ state: string; occ: string; weeks_used: number; weeks_in_window: number }>(
      `SELECT state, avg_inpatient_occupancy AS occ, weeks_used, weeks_in_window
       FROM analysis_state_measure_live WHERE measure_id = 'OP_18b'`
    )
    for (const r of rows) {
      expect(Number(r.occ)).toBeCloseTo(mean(OCCUPANCY[r.state]), 9)
      expect(r.weeks_in_window).toBe(6) // 4 good + 2 noise weeks inside the window
      expect(r.weeks_used).toBe(4)
    }
  })

  it('weights spend by days of overlap with the window', async () => {
    const { rows } = await db.query<{ state: string; spend: string }>(
      `SELECT state, stdzd_spend_pc AS spend FROM analysis_state_measure_live WHERE measure_id = 'OP_18b'`
    )
    for (const r of rows) expect(Number(r.spend)).toBeCloseTo(SPEND_2024[r.state], 6)
  })

  it('matches an independent Pearson, Spearman and partial correlation', async () => {
    const { rows: [c] } = await db.query<Record<string, number>>(
      `SELECT n, r, spearman, partial_r, r_ci_low, r_ci_high, p_value
       FROM analysis_correlations_live WHERE measure_id = 'OP_18b' AND factor = 'inpatient_occupancy'`
    )
    const x = STATES.map(s => mean(OCCUPANCY[s]))
    const y = STATES.map(expectedOutcome)
    const z = STATES.map(s => DUAL[s])
    const r = pearson(x, y), rxz = pearson(x, z), ryz = pearson(y, z)
    const partial = (r - rxz * ryz) / Math.sqrt((1 - rxz ** 2) * (1 - ryz ** 2))

    expect(Number(c.n)).toBe(STATES.length) // CT (2 hospitals) is excluded
    expect(c.r).toBeCloseTo(r, 9)
    expect(c.spearman).toBeCloseTo(pearson(ranks(x), ranks(y)), 9)
    expect(c.partial_r).toBeCloseTo(partial, 9)
    const half = 1.96 / Math.sqrt(STATES.length - 3)
    expect(c.r_ci_low).toBeCloseTo(Math.tanh(Math.atanh(r) - half), 9)
    expect(c.r_ci_high).toBeCloseTo(Math.tanh(Math.atanh(r) + half), 9)
    expect(c.p_value).toBeGreaterThan(0)
    expect(c.p_value).toBeLessThan(1)
  })

  it('applies Benjamini-Hochberg across every test', async () => {
    const { rows } = await db.query<{ p: number; q: number }>(
      `SELECT partial_p_value AS p, partial_q_value AS q FROM analysis_correlations_live WHERE partial_p_value IS NOT NULL`
    )
    const m = rows.length
    const order = rows.map((r, i) => [r.p, i] as const).sort((a, b) => a[0] - b[0])
    const expected = new Array<number>(m)
    let running = 1
    for (let k = m - 1; k >= 0; k--) {
      running = Math.min(running, (order[k][0] * m) / (k + 1))
      expected[order[k][1]] = running
    }
    expect(m).toBeGreaterThan(1)
    rows.forEach((r, i) => {
      expect(r.q).toBeCloseTo(expected[i], 12)
      expect(r.q).toBeGreaterThanOrEqual(r.p)
    })
  })

  it('orients hospital percentiles so that higher is better', async () => {
    const { rows } = await db.query<{ facility_id: string; state_percentile: number }>(
      `SELECT facility_id, state_percentile FROM analysis_hospital_percentiles_live WHERE state = 'CO' ORDER BY score`
    )
    // Lowest ER time in Colorado is best.
    expect(rows.map(r => r.state_percentile)).toEqual([1, 0.5, 0])
  })

  it('snapshots the live views and exposes the newest run', async () => {
    await db.exec(`INSERT INTO analysis_runs (id, inputs) VALUES (1, '{}'), (2, '{}')`)
    for (const run of [1, 2]) {
      await db.query('INSERT INTO analysis_correlations SELECT $1, * FROM analysis_correlations_live', [run])
    }
    const { rows } = await db.query<{ runs: string }>('SELECT count(DISTINCT run_id) AS runs FROM analysis_latest_correlations')
    expect(Number(rows[0].runs)).toBe(1)
    const { rows: [latest] } = await db.query<{ run_id: number }>('SELECT run_id FROM analysis_latest_correlations LIMIT 1')
    expect(latest.run_id).toBe(2)
  })
})
