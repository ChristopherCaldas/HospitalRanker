import fs from 'fs'
import { Client } from 'pg'
import { requireEnv } from '../../db/env'
import { inputQuery, peerColumns, standardize, VARIABLES, GROUPS, weightedScores, type PredictorRow } from '../predictors'
import { crossValidatedR2, lasso, lassoCv, pearson, wlsWithSe } from '../stats'

// Exploratory, not part of `analyze`: does access to primary and urgent care
// around a hospital explain its scores beyond what we already use? And an L1
// (lasso) pass over every dimension to see which ones carry weight.
//
//   npm run explore:access --workspace=backend [-- out.json]
//
// Everything is per measure, scores oriented so higher = better, weighted by
// inverse noise variance like the Predictors analysis. Effects are per
// standard deviation of the variable, in the measure's own units.

const log = (v: number | null) => (v === null || v <= 0 ? null : Math.log(v))
const per100k = (n: number | null, pop: number | null) => (n === null || !pop ? null : (n / pop) * 1e5)

// New variables, raw values from the query's columns.
const ACCESS: Record<string, (r: Record<string, number | null>) => number | null> = {
  pcp: r => r.ax_pcp,
  other_pc: r => r.ax_other_pc,
  office_visits: r => r.ax_em,
  urgent_care: r => per100k(r.ax_urgent, r.ax_pop),
  health_centers: r => per100k(r.ax_fqhc, r.ax_pop),
  other_eds: r => per100k(r.ax_eds, r.ax_pop),
  county_er_visits: r => r.ax_er,
  preventable_stays: r => r.ax_preventable,
  local_income: r => log(r.ax_income),
  local_density: r => log(r.ax_pop),
}
const NEW_GROUPS: Record<string, string[]> = {
  // Supply: places to go other than the ER
  access: ['pcp', 'other_pc', 'office_visits', 'urgent_care', 'health_centers', 'other_eds'],
  // Symptoms of poor access: ER use and avoidable admissions in the county
  er_reliance: ['county_er_visits', 'preventable_stays'],
  local_area: ['local_income', 'local_density'],
}
const ALL_VARS: Record<string, (r: Record<string, number | null>) => number | null> = { ...VARIABLES, ...ACCESS }
const ALL_GROUPS: Record<string, string[]> = { ...GROUPS, ...NEW_GROUPS }

const FAIR = ['peer_group', 'patients', 'community', 'complexity', 'state']
const NEW = Object.keys(NEW_GROUPS)
const KNOWN = Object.keys(GROUPS).filter(g => g !== 'track_record')

const EXTRA_COLUMNS = `
  ax.county_pcp_per_100k AS ax_pcp, ax.county_other_pc_per_100k AS ax_other_pc,
  ax.county_preventable_stays AS ax_preventable, ax.county_er_visits_per_1000 AS ax_er,
  ax.county_em_visits_per_1000 AS ax_em, ax.local_population AS ax_pop, ax.local_income AS ax_income,
  ax.urgent_care_sites AS ax_urgent, ax.health_center_sites AS ax_fqhc, ax.other_eds AS ax_eds,`
const EXTRA_JOINS = 'LEFT JOIN hospital_access ax ON ax.facility_id = s.facility_id'

type Column = { name: string; values: number[] }

function analyze(measureId: string, higherIsBetter: boolean, input: PredictorRow[]) {
  const { rows, y, w } = weightedScores(measureId, higherIsBetter, input)
  const value = (name: string, r: PredictorRow) => {
    const v = ALL_VARS[name](r.values)
    return v === null || v === undefined || !Number.isFinite(v) ? null : v
  }
  const std = Object.fromEntries(Object.keys(ALL_VARS).map(n => [n, standardize(rows.map(r => value(n, r)))]))
  const peer = rows.map(r => peerColumns(r.hospitalType, r.ownership))
  const PEER = ['critical_access', 'federal', 'other_type', 'for_profit', 'public', 'physician_owned']

  // Named columns (no intercept) for a set of groups, one missing flag per distinct pattern.
  const columns = (groups: string[]): Column[] => {
    const out: Column[] = []
    const flags = new Set<string>()
    for (const g of groups) {
      if (g === 'peer_group') PEER.forEach((n, j) => out.push({ name: n, values: peer.map(p => p[j]) }))
      else for (const v of ALL_GROUPS[g]) {
        out.push({ name: v, values: std[v].values })
        const f = std[v].flag
        if (f && !flags.has(f.join(''))) {
          flags.add(f.join(''))
          out.push({ name: `missing_${v}`, values: f })
        }
      }
    }
    return out
  }
  const matrix = (cols: Column[], idx = rows.map((_, i) => i)) => idx.map(i => cols.map(c => c.values[i]))
  const r2 = (groups: string[], idx = rows.map((_, i) => i)) =>
    crossValidatedR2(matrix(columns(groups), idx).map(x => [1, ...x]), idx.map(i => y[i]), idx.map(i => w[i]))

  // 1. Does access add predictive power?
  const models = {
    fair: r2(FAIR),
    fair_plus_access: r2([...FAIR, 'access']),
    fair_plus_all_new: r2([...FAIR, ...NEW]),
    everything_known: r2(KNOWN),
    everything_plus_all_new: r2([...KNOWN, ...NEW]),
  }
  const alone = Object.fromEntries(NEW.map(g => [g, r2([g])]))

  // Urban vs rural separately (rural flag from the IPPS file / critical access).
  const split = Object.fromEntries((['urban', 'rural'] as const).map(kind => {
    const idx = rows.map((r, i) => i).filter(i => (rows[i].values.rural === 1) === (kind === 'rural') && rows[i].values.rural !== null)
    return [kind, idx.length < 200 ? null : {
      hospitals: idx.length, fair: r2(FAIR, idx), fair_plus_all_new: r2([...FAIR, ...NEW], idx),
    }]
  }))

  // 2. The hypothesis directly: does urgent care / primary care matter, and
  // does it matter more where incomes are low? WLS on fair context + local
  // area + access, with an urgent care x low income interaction.
  const base = columns([...FAIR, 'local_area', 'access'])
  const lowIncome = std.local_income.values.map(v => -v)
  const interact: Column[] = [
    { name: 'urgent_care_x_low_income', values: std.urgent_care.values.map((v, i) => v * lowIncome[i]) },
    { name: 'pcp_x_low_income', values: std.pcp.values.map((v, i) => v * lowIncome[i]) },
  ]
  const fitCols = [...base, ...interact]
  const { beta, se } = wlsWithSe(matrix(fitCols).map(x => [1, ...x]), y, w)
  const coefficient = (name: string) => {
    const j = fitCols.findIndex(c => c.name === name) + 1
    return { estimate: beta[j], se: se[j], t: beta[j] / se[j] }
  }
  const hypothesis = Object.fromEntries(
    ['urgent_care', 'pcp', 'other_pc', 'health_centers', 'other_eds', 'office_visits', 'local_income', 'local_density',
      'urgent_care_x_low_income', 'pcp_x_low_income'].map(n => [n, coefficient(n)])
  )

  // Mediation check: do the community/patient coefficients shrink once access is in?
  const coefs = (cols: Column[]) => {
    const fit = wlsWithSe(matrix(cols).map(x => [1, ...x]), y, w)
    return Object.fromEntries(['svi', 'poverty', 'uninsured', 'dual', 'dsh', 'rural']
      .map(n => [n, cols.findIndex(c => c.name === n)]).filter(([, j]) => (j as number) >= 0)
      .map(([n, j]) => [n, { estimate: fit.beta[(j as number) + 1], se: fit.se[(j as number) + 1] }]))
  }
  const mediation = { without_access: coefs(columns(FAIR)), with_access: coefs(columns([...FAIR, ...NEW])) }

  // Simple correlations of the new variables with the score and with local income.
  const correlations = Object.fromEntries(Object.keys(ACCESS).map(n => {
    const idx = rows.map((r, i) => i).filter(i => value(n, rows[i]) !== null)
    const inc = idx.filter(i => value('local_income', rows[i]) !== null)
    return [n, {
      with_score: pearson(idx.map(i => value(n, rows[i])!), idx.map(i => y[i])),
      with_local_income: pearson(inc.map(i => value(n, rows[i])!), inc.map(i => value('local_income', rows[i])!)),
      coverage: idx.length / rows.length,
    }]
  }))

  // 3. L1: lasso over fair context + new, and over everything + new.
  const l1 = (groups: string[]) => {
    const cols = columns(groups)
    const X = matrix(cols)
    const cv = lassoCv(X, y, w)
    const chosen = cv.path[cv.oneSe]
    // Stability: how often each variable survives at the chosen lambda in
    // 50 random half-samples (deterministic seed).
    let seed = 12345
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const kept = new Array<number>(cols.length).fill(0)
    const B = 50
    for (let b = 0; b < B; b++) {
      const idx = rows.map((_, i) => i).filter(() => rand() < 0.5)
      const fit = lasso(idx.map(i => X[i]), idx.map(i => y[i]), idx.map(i => w[i]), cv.lambdas[cv.oneSe])
      fit.beta.forEach((v, j) => { if (v !== 0) kept[j]++ })
    }
    // Order variables enter the path.
    const entry = cols.map((_, j) => cv.path.findIndex(b => b[j] !== 0))
    return {
      cv_r2_best: cv.cvR2[cv.best],
      cv_r2_one_se: cv.cvR2[cv.oneSe],
      ols_cv_r2: crossValidatedR2(X.map(x => [1, ...x]), y, w),
      kept: chosen.filter(v => v !== 0).length,
      of: cols.length,
      variables: cols
        .map((c, j) => ({ name: c.name, effect: chosen[j], stability: kept[j] / B, entry: entry[j] < 0 ? null : entry[j] }))
        .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect) || b.stability - a.stability),
    }
  }

  return {
    hospitals: rows.length,
    sd_score: Math.sqrt(y.reduce((a, v) => a + (v - y.reduce((s, u) => s + u, 0) / y.length) ** 2, 0) / y.length),
    models, alone, split, hypothesis, mediation, correlations,
    lasso: { fair_plus_new: l1([...FAIR, ...NEW]), everything_plus_new: l1([...KNOWN, ...NEW]) },
  }
}

async function main() {
  const out = process.argv[2]
  const db = new Client({ connectionString: requireEnv('DATABASE_URL_UNPOOLED') })
  await db.connect()
  try {
    const { rows } = await db.query(inputQuery(EXTRA_COLUMNS, EXTRA_JOINS))
    const numeric = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    const results: Record<string, ReturnType<typeof analyze>> = {}
    for (const measureId of [...new Set(rows.map(r => r.measure_id as string))].sort()) {
      const mr = rows.filter(r => r.measure_id === measureId)
      const res = analyze(measureId, mr[0].higher_is_better, mr.map(r => ({
        facilityId: r.facility_id, score: r.score, cases: r.cases,
        lowerEstimate: r.lower_estimate, higherEstimate: r.higher_estimate,
        hospitalType: r.hospital_type, ownership: r.ownership, prior: r.prior,
        values: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' || typeof v === 'string' ? numeric(v) : null])),
      })))
      results[measureId] = res
      const pct = (v: number) => `${(v * 100).toFixed(1)}%`
      console.log(`\n== ${measureId} (${res.hospitals} hospitals)`)
      console.table(Object.fromEntries(Object.entries(res.models).map(([k, v]) => [k, pct(v)])))
      console.table(Object.fromEntries(Object.entries(res.hypothesis).map(([k, v]) => [k, { effect: +v.estimate.toFixed(3), t: +v.t.toFixed(1) }])))
      for (const [k, l] of Object.entries(res.lasso)) {
        console.log(`  lasso ${k}: kept ${l.kept}/${l.of}, CV R2 ${pct(l.cv_r2_one_se)} (best ${pct(l.cv_r2_best)}, OLS ${pct(l.ols_cv_r2)})`)
        console.table(l.variables.filter(v => v.effect !== 0 || v.stability >= 0.5).slice(0, 15)
          .map(v => ({ name: v.name, effect: +v.effect.toFixed(3), stability: v.stability })))
      }
    }
    if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2))
  } finally {
    await db.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
