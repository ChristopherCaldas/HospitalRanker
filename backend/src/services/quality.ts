import { pool } from '../db/pool'

// Reads the Donabedian chain tests (analysis/chain.ts), the equity analysis
// (analysis/equity.ts) and puts hospital costs next to results (value).

export interface ChainRow {
  link: 'structure_process' | 'structure_outcome' | 'process_outcome' | 'pair'
  x: string
  y: string
  n: number
  r: number | null
  rCiLow: number | null
  rCiHigh: number | null
  spearman: number | null
  partialR: number | null
  qValue: number | null
  topFifth: number | null
  bottomFifth: number | null
}

export async function getChain(): Promise<{ runCreatedAt: string; tests: ChainRow[] } | null> {
  const { rows } = await pool.query<ChainRow & { runCreatedAt: string }>(
    `SELECT to_char(r.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS "runCreatedAt", c.link, c.x, c.y, c.n, c.r,
            c.r_ci_low AS "rCiLow", c.r_ci_high AS "rCiHigh", c.spearman, c.partial_r AS "partialR",
            c.q_value AS "qValue", c.top_fifth AS "topFifth", c.bottom_fifth AS "bottomFifth"
     FROM analysis_latest_chain c JOIN analysis_runs r ON r.id = c.run_id
     ORDER BY c.link, c.x, c.y`
  )
  if (rows.length === 0) return null
  return { runCreatedAt: rows[0].runCreatedAt, tests: rows.map(({ runCreatedAt: _r, ...t }) => t) }
}

export interface EquityFifth {
  fifth: number
  dualLow: number
  dualHigh: number
  hospitals: number
  scores: Record<string, { raw: number | null; adjusted: number | null; n: number }>
  money: Record<string, { median: number | null; n: number }>
  within: Record<string, { spearman: number | null; n: number }>
  medianMspb: number | null
}

export async function getEquity(): Promise<{ fifths: EquityFifth[] } | null> {
  const { rows } = await pool.query<EquityFifth>(
    `SELECT f.fifth, f.dual_low AS "dualLow", f.dual_high AS "dualHigh", f.hospitals, f.scores, f.money, f.within,
            (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s.score)
             FROM analysis_latest_hospital_peer p
             JOIN latest_measure_scores s ON s.facility_id = p.facility_id AND s.measure_id = 'MSPB-1'
             WHERE p.fifth = f.fifth)::float8 AS "medianMspb"
     FROM analysis_latest_equity_fifths f ORDER BY f.fifth`
  )
  return rows.length ? { fifths: rows } : null
}

export interface ValueHospital {
  id: string
  name: string
  city: string | null
  state: string
  mspb: number
  outcome: number
  verdict: string
}

export interface ValueFifth {
  fifth: number
  hospitals: number
  lo: number
  hi: number
  avgOutcome: number
  se: number
}

export interface ValueOverview {
  windowStart: string
  windowEnd: string
  hospitals: number
  medianMspb: number
  p10Mspb: number
  p90Mspb: number
  medianCostAdj: number | null
  spearmanMspbOutcome: number | null
  spearmanCostOutcome: number | null
  spearmanMspbCost: number | null
  quadrants: { betterCheaper: number; betterCostlier: number; worseCheaper: number; worseCostlier: number }
  mspbFifths: ValueFifth[]
  costFifths: ValueFifth[]
  highValue: ValueHospital[]
  lowValue: ValueHospital[]
}

// MSPB-1 (what Medicare pays around a stay, price-standardized and
// risk-adjusted, 1 = national median) and the hospital's own cost per
// discharge divided by its case mix index, next to the outcome score.
const VALUE_BASE = `
  WITH v AS (
    SELECT h.facility_id AS id, h.name, h.city, h.state, s.score::float8 AS mspb, s.start_date, s.end_date,
           CASE WHEN f.cost_per_discharge > 0 AND c.case_mix_index > 0
                THEN f.cost_per_discharge / c.case_mix_index END::float8 AS cost_adj,
           o.score AS outcome, o.verdict
    FROM latest_measure_scores s
    JOIN hospitals h USING (facility_id)
    JOIN analysis_latest_hospital_scores o ON o.facility_id = s.facility_id AND o.scope = 'outcome'
    LEFT JOIN hospital_finance_ratios f ON f.facility_id = s.facility_id
    LEFT JOIN hospital_context c ON c.facility_id = s.facility_id
    WHERE s.measure_id = 'MSPB-1' AND s.score IS NOT NULL
  )`

// Spearman: Pearson correlation of average ranks (ties share a rank).
const spearmanSql = (a: string, b: string) => `
  (SELECT corr(ra, rb) FROM (
     SELECT rank() OVER (ORDER BY ${a}) + (count(*) OVER (PARTITION BY ${a}) - 1) / 2.0 AS ra,
            rank() OVER (ORDER BY ${b}) + (count(*) OVER (PARTITION BY ${b}) - 1) / 2.0 AS rb
     FROM v WHERE ${a} IS NOT NULL AND ${b} IS NOT NULL) x)`

const fifthsSql = (col: string) => `${VALUE_BASE}
  , q AS (SELECT ${col} AS x, outcome, ntile(5) OVER (ORDER BY ${col}) AS fifth FROM v WHERE ${col} IS NOT NULL)
  SELECT fifth, count(*)::int AS hospitals, min(x) AS lo, max(x) AS hi, avg(outcome) AS "avgOutcome",
         stddev_samp(outcome) / sqrt(count(*)) AS se
  FROM q GROUP BY fifth ORDER BY fifth`

const TTL_MS = 60 * 60 * 1000
let cache: { at: number; value: Promise<ValueOverview | null> } | null = null
export function clearValueCache(): void {
  cache = null
}

export function getValue(): Promise<ValueOverview | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  const value = loadValue()
  value.catch(() => { cache = null })
  cache = { at: Date.now(), value }
  return value
}

async function loadValue(): Promise<ValueOverview | null> {
  const list = (where: string, order: string) => pool.query<ValueHospital>(
    `${VALUE_BASE} SELECT id, name, city, state, mspb, outcome, verdict FROM v WHERE ${where} ORDER BY ${order}, name LIMIT 8`
  )
  const [summary, mspbFifths, costFifths, high, low] = await Promise.all([
    pool.query(
      `${VALUE_BASE}
       SELECT to_char(min(start_date), 'YYYY-MM-DD') AS "windowStart", to_char(max(end_date), 'YYYY-MM-DD') AS "windowEnd",
              count(*)::int AS hospitals,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY mspb) AS "medianMspb",
              percentile_cont(0.1) WITHIN GROUP (ORDER BY mspb) AS "p10Mspb",
              percentile_cont(0.9) WITHIN GROUP (ORDER BY mspb) AS "p90Mspb",
              percentile_cont(0.5) WITHIN GROUP (ORDER BY cost_adj) AS "medianCostAdj",
              ${spearmanSql('mspb', 'outcome')} AS "spearmanMspbOutcome",
              ${spearmanSql('cost_adj', 'outcome')} AS "spearmanCostOutcome",
              ${spearmanSql('mspb', 'cost_adj')} AS "spearmanMspbCost",
              json_build_object(
                'betterCheaper', count(*) FILTER (WHERE outcome >= 0 AND mspb <= 1),
                'betterCostlier', count(*) FILTER (WHERE outcome >= 0 AND mspb > 1),
                'worseCheaper', count(*) FILTER (WHERE outcome < 0 AND mspb <= 1),
                'worseCostlier', count(*) FILTER (WHERE outcome < 0 AND mspb > 1)) AS quadrants
       FROM v`
    ),
    pool.query<ValueFifth>(fifthsSql('mspb')),
    pool.query<ValueFifth>(fifthsSql('cost_adj')),
    // Clearly better outcomes for less Medicare money, and the reverse.
    list(`mspb < 0.95 AND verdict = 'better'`, 'outcome DESC'),
    list(`mspb > 1.05 AND verdict = 'worse'`, 'outcome ASC'),
  ])
  if (!summary.rows[0] || summary.rows[0].hospitals === 0) return null
  return {
    ...summary.rows[0],
    mspbFifths: mspbFifths.rows,
    costFifths: costFifths.rows,
    highValue: high.rows,
    lowValue: low.rows,
  }
}
