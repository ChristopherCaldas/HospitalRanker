import fs from 'fs'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { analyzePredictors, persistence, type PredictorRow } from '../src/analysis/predictors'
import { systemRows } from '../src/ingest/context'

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32
    return seed / 2 ** 32
  }
}

// Synthetic ER waits (lower is better): bigger hospitals wait longer; each
// hospital has a lasting quality of its own that shows up in its earlier
// score too; profit margins and state spending are pure noise.
function synthetic(seed = 7): PredictorRow[] {
  const r = rng(seed)
  const normal = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())
  return Array.from({ length: 2000 }, (_, i) => {
    const beds = Math.round(Math.exp(3 + 3 * r()))
    const own = 25 * normal()
    const score = 80 + 20 * Math.log(beds) + own + 5 * normal()
    return {
      facilityId: `H${i}`, score, cases: 50 + Math.floor(r() * 950), lowerEstimate: null, higherEstimate: null,
      hospitalType: 'Acute Care Hospitals', ownership: 'Voluntary non-profit - Private',
      prior: 80 + 20 * Math.log(beds) + own + 5 * normal(),
      values: { beds, patient_margin: 0.1 * normal(), st_spend: 10000 + 1000 * normal(), system_hospitals: i % 3 ? 5 : null },
    }
  })
}

describe('analyzePredictors', () => {
  const result = analyzePredictors('OP_18b', false, synthetic())

  it('finds the planted predictors and not the noise', () => {
    expect(result.groups.size.alone).toBeGreaterThan(0.2) // planted: about 0.3
    expect(result.groups.profit.alone).toBeLessThan(0.01)
    expect(result.groups.state.alone).toBeLessThan(0.01)
    expect(result.variables.beds.r).toBeLessThan(-0.5) // more beds, longer waits = worse
  })

  it('credits the track record with the lasting part size does not explain', () => {
    expect(result.models.with_track_record).toBeGreaterThan(result.models.everything_known + 0.3)
    expect(result.groups.track_record.added).toBeCloseTo(result.models.with_track_record - result.models.everything_known)
    expect(result.variables.prior_score.r).toBeGreaterThan(0.8)
  })

  it('reports coverage, including missing values', () => {
    expect(result.variables.in_system.coverage).toBeCloseTo(2 / 3, 2)
    expect(result.hospitals).toBe(2000)
  })
})

describe('persistence', () => {
  const scores = (pairs: [string, number][]) => new Map(pairs)
  const current = { start: '2024-10-01', end: '2025-09-30', scores: scores([['A', 1], ['B', 2], ['C', 3]]) }

  it('marks earlier periods that share months with the current one', () => {
    const many = (k: number) => scores(Array.from({ length: 40 }, (_, i) => [`H${i}`, i * k]))
    const cur = { ...current, scores: many(1) }
    const out = persistence(cur, [
      { start: '2024-01-01', end: '2024-12-31', scores: many(2) },
      { start: '2018-01-01', end: '2018-12-31', scores: many(-1) },
      { start: '2025-10-01', end: '2026-09-30', scores: many(1) }, // later: ignored
    ])
    expect(out.map(p => [p.end, p.overlapping, Math.round(p.r)])).toEqual([
      ['2024-12-31', true, 1],
      ['2018-12-31', false, -1],
    ])
    expect(out[1].yearsBack).toBeCloseTo(6.75, 1)
  })

  it('skips periods with too few hospitals in common', () => {
    expect(persistence(current, [{ start: null, end: '2019-12-31', scores: scores([['A', 1], ['B', 2], ['C', 3]]) }])).toEqual([])
  })
})

describe('systemRows', () => {
  it('counts hospitals per system and treats unaffiliated hospitals as size 1', () => {
    const rows = systemRows([
      { ccn: '10001', health_sys_id: 'S1', health_sys_name: 'One' },
      { ccn: '010002', health_sys_id: 'S1', health_sys_name: 'One' },
      { ccn: '030003', health_sys_id: '', health_sys_name: '' },
    ])
    expect(rows.get('010001')).toEqual({ systemId: 'S1', systemName: 'One', systemHospitals: 2 })
    expect(rows.get('030003')).toEqual({ systemId: null, systemName: null, systemHospitals: 1 })
  })
})

describe('migration 011', () => {
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
    const dir = path.join(__dirname, '../migrations')
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      await db.exec(fs.readFileSync(path.join(dir, file), 'utf8'))
    }
    await db.exec(`
      INSERT INTO hospitals (facility_id, name, state) VALUES ('H1', 'One', 'AL');
      INSERT INTO hospital_finance (facility_id, fiscal_year_end, beds, total_costs, total_discharges, total_assets,
                                    total_liabilities, current_assets, current_liabilities, investments, salaries, fte_employees)
      VALUES ('H1', '2024-12-31', 100, 50000000, 5000, 200, 50, 30, 10, 0, 400, 0);
    `)
  })

  afterAll(async () => {
    await db.close()
  })

  it('adds balance-sheet ratios to the finance view', async () => {
    const { rows: [r] } = await db.query<Record<string, number | null>>('SELECT * FROM hospital_finance_ratios')
    expect(r.cost_per_discharge).toBe(10000)
    expect(r.debt_ratio).toBeCloseTo(0.25)
    expect(r.current_ratio).toBeCloseTo(3)
    expect(r.investments_per_bed).toBe(0)
    expect(r.salary_per_fte).toBeNull()
  })
})
