import type { Client } from 'pg'
import { benjaminiHochberg, correlationTest, partialCorrelation, pearson, spearman } from './stats'

// Donabedian's chain: good structure makes good process more likely, and good
// process makes good outcomes more likely. Tested across hospitals on the
// expected-model scores, which already account for fair context (patients,
// community, peer group, state), so a link here isn't just "richer areas do
// better on everything".
//
//   structure_process  each structure variable vs. the process score
//   structure_outcome  each structure variable vs. the clinical outcome score,
//                      and the same with the process score held constant
//                      (how much of the link runs through process)
//   process_outcome    process scores vs. clinical outcome scores
//   pair               curated clinical pairs (sepsis care vs. deaths, ...)
//
// "Clinical outcome" averages the mortality, safety and readmission group
// scores. The outcome domain also holds patients' overall rating and
// willingness to recommend, which come from the same surveys as the
// communication items in the process score; correlating those would partly
// measure one survey twice. For the same reason the clinical process score
// (timely and effective care, no surveys) is tested on its own.
//
// Structure variables are the ones management controls: staffing, pay,
// buildings and equipment, money, size and system membership. Teaching and
// case mix are fair context in the expected model, so they aren't tested.

export const STRUCTURE_VARS: Record<string, { column: string; log?: boolean }> = {
  fte_per_bed: { column: 'fte_per_bed' },
  salary_per_fte: { column: 'salary_per_fte' },
  contract_labor: { column: 'contract_labor_share' },
  cost_per_discharge: { column: 'cost_per_discharge', log: true },
  fixed_assets_per_bed: { column: 'fixed_assets_per_bed', log: true },
  investments_per_bed: { column: 'investments_per_bed', log: true },
  patient_margin: { column: 'patient_margin' },
  total_margin: { column: 'total_margin' },
  beds: { column: 'beds', log: true },
  in_system: { column: 'in_system' },
}

const CLINICAL_OUTCOME_GROUPS = ['mortality', 'safety', 'readmission']

// x is a process measure, y an outcome measure or group score.
export const PAIRS: [string, string][] = [
  ['SEP_1', 'mortality'],
  ['SEP_1', 'MORT_30_PN'],
  ['OP_23', 'MORT_30_STK'],
  ['OP_18b', 'mortality'],
  ['H_COMP_6_STAR_RATING', 'readmission'],
  ['H_COMP_5_STAR_RATING', 'readmission'],
  ['H_COMP_1_STAR_RATING', 'safety'],
]

export interface ChainHospital {
  structure: Record<string, number | null>
  // Scope scores (overall, domains, groups) and per-measure scores, all in
  // tau units with + = better.
  scores: Record<string, number>
}

export interface ChainTest {
  link: 'structure_process' | 'structure_outcome' | 'process_outcome' | 'pair'
  x: string
  y: string
  n: number
  r: number | null
  rCiLow: number | null
  rCiHigh: number | null
  spearman: number | null
  partialR: number | null
  pValue: number | null
  qValue: number | null
  topFifth: number | null
  bottomFifth: number | null
}

// Clinical outcome: mean of the clinical outcome groups a hospital has, if 2+.
export function clinicalOutcome(scores: Record<string, number>): number | null {
  const vals = CLINICAL_OUTCOME_GROUPS.map(g => scores[g]).filter((v): v is number => v !== undefined)
  return vals.length >= 2 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

// Clip at the 1st/99th percentile so a few extreme cost-report values can't
// drive a Pearson r.
function clip(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const lo = sorted[Math.floor((sorted.length - 1) * 0.01)]
  const hi = sorted[Math.ceil((sorted.length - 1) * 0.99)]
  return values.map(v => Math.min(hi, Math.max(lo, v)))
}

function fifths(x: number[], y: number[]): { top: number; bottom: number } {
  const order = x.map((v, i) => [v, y[i]] as const).sort((a, b) => a[0] - b[0])
  const size = Math.floor(order.length / 5)
  const mean = (rows: (readonly [number, number])[]) => rows.reduce((a, [, v]) => a + v, 0) / rows.length
  return { bottom: mean(order.slice(0, size)), top: mean(order.slice(order.length - size)) }
}

function test(link: ChainTest['link'], xName: string, yName: string, rows: { x: number; y: number; z?: number }[]): ChainTest {
  const empty: ChainTest = {
    link, x: xName, y: yName, n: rows.length, r: null, rCiLow: null, rCiHigh: null, spearman: null,
    partialR: null, pValue: null, qValue: null, topFifth: null, bottomFifth: null,
  }
  if (rows.length < 30) return empty
  const x = clip(rows.map(r => r.x))
  const y = rows.map(r => r.y)
  const r = pearson(x, y)
  const t = correlationTest(r, rows.length)
  const f = fifths(x, y)
  const withZ = rows.every(row => row.z !== undefined)
  return {
    ...empty,
    r,
    rCiLow: t?.low ?? null,
    rCiHigh: t?.high ?? null,
    spearman: spearman(x, y),
    partialR: withZ ? partialCorrelation(x, y, rows.map(row => row.z!)) : null,
    pValue: t?.p ?? null,
    topFifth: f.top,
    bottomFifth: f.bottom,
  }
}

export function chainTests(hospitals: ChainHospital[]): ChainTest[] {
  const tests: ChainTest[] = []
  const withClinical = hospitals.map(h => ({ ...h, clinical: clinicalOutcome(h.scores) }))
  const structureValue = (h: ChainHospital, name: string) => {
    const v = h.structure[name]
    if (v === null || v === undefined || !Number.isFinite(v)) return null
    return STRUCTURE_VARS[name].log ? Math.log1p(Math.max(0, v)) : v
  }

  for (const name of Object.keys(STRUCTURE_VARS)) {
    const process: { x: number; y: number }[] = []
    const outcome: { x: number; y: number; z: number }[] = []
    for (const h of withClinical) {
      const x = structureValue(h, name)
      if (x === null) continue
      const p = h.scores.process
      if (p !== undefined) process.push({ x, y: p })
      if (p !== undefined && h.clinical !== null) outcome.push({ x, y: h.clinical, z: p })
    }
    tests.push(test('structure_process', name, 'process', process))
    tests.push(test('structure_outcome', name, 'clinical_outcome', outcome))
  }

  for (const x of ['process', 'timely_effective']) {
    for (const y of ['clinical_outcome', ...CLINICAL_OUTCOME_GROUPS]) {
      const rows = withClinical.flatMap(h => {
        const xv = h.scores[x]
        const yv = y === 'clinical_outcome' ? h.clinical : h.scores[y]
        return xv === undefined || yv === null || yv === undefined ? [] : [{ x: xv, y: yv }]
      })
      tests.push(test('process_outcome', x, y, rows))
    }
  }

  for (const [x, y] of PAIRS) {
    const rows = hospitals.flatMap(h =>
      h.scores[x] === undefined || h.scores[y] === undefined ? [] : [{ x: h.scores[x], y: h.scores[y] }]
    )
    tests.push(test('pair', x, y, rows))
  }

  const tested = tests.filter(t => t.pValue !== null)
  const q = benjaminiHochberg(tested.map(t => t.pValue!))
  tested.forEach((t, i) => { t.qValue = q[i] })
  return tests
}

// Reads this run's scores and the cost-report structure variables, writes the
// chain tests. Runs inside the analyze job's transaction, after the expected
// model.
export async function writeChain(db: Client, runId: number): Promise<void> {
  const { rows: scopeRows } = await db.query(
    'SELECT facility_id, scope, score FROM analysis_hospital_scores WHERE run_id = $1', [runId])
  const { rows: measureRows } = await db.query(
    `SELECT e.facility_id, e.measure_id, e.adjusted_gap / m.tau AS score
     FROM analysis_hospital_expected e
     JOIN analysis_expected_models m ON m.run_id = e.run_id AND m.measure_id = e.measure_id
     WHERE e.run_id = $1 AND m.tau > 0`, [runId])
  const columns = Object.values(STRUCTURE_VARS).map(v => v.column).filter(c => c !== 'in_system')
  const { rows: structureRows } = await db.query(
    `SELECT f.facility_id, ${columns.map(c => `f.${c}::float8 AS ${c}`).join(', ')},
            (c.system_hospitals > 1)::int AS in_system
     FROM hospital_finance_ratios f LEFT JOIN hospital_context c USING (facility_id)`)

  const byId = new Map<string, ChainHospital>()
  const get = (id: string) => {
    if (!byId.has(id)) byId.set(id, { structure: {}, scores: {} })
    return byId.get(id)!
  }
  for (const r of scopeRows) get(r.facility_id).scores[r.scope] = r.score
  for (const r of measureRows) get(r.facility_id).scores[r.measure_id] = Number(r.score)
  for (const r of structureRows) {
    if (!byId.has(r.facility_id)) continue
    const h = get(r.facility_id)
    for (const [name, { column }] of Object.entries(STRUCTURE_VARS)) {
      h.structure[name] = r[column] === null || r[column] === undefined ? null : Number(r[column])
    }
  }

  const tests = chainTests([...byId.values()])
  const col = <K extends keyof ChainTest>(k: K) => tests.map(t => t[k])
  await db.query(
    `INSERT INTO analysis_chain (run_id, link, x, y, n, r, r_ci_low, r_ci_high, spearman, partial_r, q_value, top_fifth, bottom_fifth)
     SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::float8[], $7::float8[], $8::float8[],
                              $9::float8[], $10::float8[], $11::float8[], $12::float8[], $13::float8[])`,
    [runId, col('link'), col('x'), col('y'), col('n'), col('r'), col('rCiLow'), col('rCiHigh'), col('spearman'),
      col('partialR'), col('qValue'), col('topFifth'), col('bottomFifth')]
  )
  const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(2))
  for (const t of tests) {
    console.log(`  chain ${t.link} ${t.x} -> ${t.y}: n ${t.n}, r ${fmt(t.r)}${t.partialR !== null ? ` (partial ${fmt(t.partialR)})` : ''}, q ${fmt(t.qValue)}`)
  }
}
