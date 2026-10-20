import { pool } from '../db/pool'

// Hospital finances (Medicare cost reports, migration 010) and the
// hospital-level context the expected-score model adjusts for. Finances are
// diagnostics only: the model deliberately doesn't adjust for them.

// Ratio columns of hospital_finance_ratios shown to readers. Margins and shares
// outside these bounds are cost-report artifacts (e.g. near-zero revenue) and
// are left out of medians and comparisons.
export const FINANCE_METRICS = {
  patient_margin: { min: -1, max: 1 },
  total_margin: { min: -1, max: 1 },
  other_income_share: { min: 0, max: 2 },
  uncompensated_share: { min: 0, max: 1 },
  medicaid_day_share: { min: 0, max: 1 },
  contract_labor_share: { min: 0, max: 1 },
  fte_per_bed: { min: 0, max: 30 },
  occupancy: { min: 0, max: 1.2 },
} as const
export type FinanceMetric = keyof typeof FINANCE_METRICS

const clean = (m: FinanceMetric, alias = '') =>
  `CASE WHEN ${alias}${m} BETWEEN ${FINANCE_METRICS[m].min} AND ${FINANCE_METRICS[m].max} THEN ${alias}${m} END`

export const CONTEXT_FIELDS = [
  'dual_proportion', 'dsh_pct', 'case_mix_index', 'resident_bed_ratio', 'svi_percentile', 'poverty150_pct', 'uninsured_pct',
] as const

const METRICS = Object.keys(FINANCE_METRICS) as FinanceMetric[]
const camel = (s: string) => s.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())

// Medians change only when data is reloaded, so they're cached briefly.
const TTL_MS = 60 * 60 * 1000
const cache = new Map<string, { at: number; value: Promise<unknown> }>()
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>
  const value = load()
  value.catch(() => cache.delete(key))
  cache.set(key, { at: Date.now(), value })
  return value
}
export function clearFinanceCache(): void {
  cache.clear()
}

// National and per-hospital-type medians of every finance metric and context field.
function medians(): Promise<{ national: Record<string, number | null>; byType: Record<string, Record<string, number | null>> }> {
  return cached('medians', async () => {
    const cols = [
      ...METRICS.map(m => `percentile_cont(0.5) WITHIN GROUP (ORDER BY ${clean(m, 'f.')}) AS "${camel(m)}"`),
      ...CONTEXT_FIELDS.map(c => `percentile_cont(0.5) WITHIN GROUP (ORDER BY c.${c}) AS "${camel(c)}"`),
    ].join(', ')
    const from = `FROM hospitals h
      LEFT JOIN hospital_finance_ratios f USING (facility_id)
      LEFT JOIN hospital_context c USING (facility_id)`
    const [national, byType] = await Promise.all([
      pool.query(`SELECT ${cols} ${from}`),
      pool.query(`SELECT h.hospital_type AS type, ${cols} ${from} GROUP BY h.hospital_type`),
    ])
    return {
      national: national.rows[0],
      byType: Object.fromEntries(byType.rows.map(({ type, ...rest }) => [type, rest])),
    }
  })
}

export async function getHospitalFinance(id: string) {
  const [{ rows: [row] }, med] = await Promise.all([
    pool.query(
      `SELECT h.hospital_type AS "hospitalType",
              to_char(f.fiscal_year_begin, 'YYYY-MM-DD') AS "fiscalYearBegin",
              to_char(f.fiscal_year_end, 'YYYY-MM-DD') AS "fiscalYearEnd",
              f.beds, f.net_patient_revenue AS "netPatientRevenue", f.total_other_income AS "otherIncome",
              ${METRICS.map(m => `${clean(m, 'r.')} AS "${camel(m)}"`).join(', ')},
              ${CONTEXT_FIELDS.map(c => `c.${c} AS "${camel(c)}"`).join(', ')}, c.rural,
              (f.facility_id IS NOT NULL) AS "hasFinance", (c.facility_id IS NOT NULL) AS "hasContext"
       FROM hospitals h
       LEFT JOIN hospital_finance f USING (facility_id)
       LEFT JOIN hospital_finance_ratios r USING (facility_id)
       LEFT JOIN hospital_context c USING (facility_id)
       WHERE h.facility_id = $1`,
      [id]
    ),
    medians(),
  ])
  if (!row) return { finance: null, context: null }
  const pick = (keys: readonly string[], src: Record<string, unknown>) =>
    Object.fromEntries(keys.map(k => [camel(k), src[camel(k)] ?? null]))
  const typeMedians = med.byType[row.hospitalType] ?? {}
  return {
    finance: row.hasFinance
      ? {
          fiscalYearBegin: row.fiscalYearBegin,
          fiscalYearEnd: row.fiscalYearEnd,
          beds: row.beds,
          netPatientRevenue: row.netPatientRevenue,
          otherIncome: row.otherIncome,
          values: pick(METRICS, row),
          nationalMedians: pick(METRICS, med.national),
          typeMedians: pick(METRICS, typeMedians),
        }
      : null,
    context: row.hasContext
      ? {
          values: { ...pick(CONTEXT_FIELDS, row), rural: row.rural },
          nationalMedians: pick(CONTEXT_FIELDS, med.national),
        }
      : null,
  }
}

// The Finances page: money by ownership, and how each finance metric lines up
// with the context-adjusted overall score (by fifths of the metric).
export function getFinanceOverview() {
  return cached('overview', async () => {
    const ownershipGroup = `CASE
        WHEN h.hospital_type ~ 'Veterans|Defense' OR h.ownership ~ 'Federal' THEN 'Federal'
        WHEN h.ownership = 'Proprietary' THEN 'For-profit'
        WHEN h.ownership = 'Physician' THEN 'Physician-owned'
        WHEN h.ownership ~ '^Government' OR h.ownership = 'Tribal' THEN 'State or local government'
        WHEN h.ownership ~ '^Voluntary' THEN 'Non-profit'
        ELSE 'Other' END`
    const [summary, byOwnership, ...metricRows] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS hospitals,
                to_char(min(fiscal_year_end), 'YYYY-MM-DD') AS "firstYearEnd",
                to_char(max(fiscal_year_end), 'YYYY-MM-DD') AS "lastYearEnd",
                percentile_cont(0.5) WITHIN GROUP (ORDER BY ${clean('patient_margin')}) AS "patientMargin",
                percentile_cont(0.5) WITHIN GROUP (ORDER BY ${clean('total_margin')}) AS "totalMargin",
                avg((${clean('patient_margin')} < 0)::int)::float8 AS "losingOnPatients",
                avg((${clean('total_margin')} < 0)::int)::float8 AS "losingOverall"
         FROM hospital_finance_ratios`
      ),
      pool.query(
        `SELECT ${ownershipGroup} AS ownership, count(*)::int AS hospitals,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY ${clean('patient_margin', 'r.')}) AS "patientMargin",
                percentile_cont(0.5) WITHIN GROUP (ORDER BY ${clean('total_margin', 'r.')}) AS "totalMargin",
                percentile_cont(0.5) WITHIN GROUP (ORDER BY ${clean('other_income_share', 'r.')}) AS "otherIncomeShare",
                percentile_cont(0.5) WITHIN GROUP (ORDER BY ${clean('uncompensated_share', 'r.')}) AS "uncompensatedShare",
                percentile_cont(0.5) WITHIN GROUP (ORDER BY ${clean('medicaid_day_share', 'r.')}) AS "medicaidDayShare",
                avg((${clean('total_margin', 'r.')} < 0)::int)::float8 AS "losingOverall"
         FROM hospital_finance_ratios r JOIN hospitals h USING (facility_id)
         GROUP BY 1 HAVING count(*) >= 20 ORDER BY count(*) DESC`
      ),
      ...METRICS.map(m =>
        pool.query(
          `WITH x AS (
             SELECT ${clean(m, 'r.')} AS v, c.score
             FROM analysis_latest_hospital_composite c JOIN hospital_finance_ratios r USING (facility_id)
           ), q AS (SELECT v, score, ntile(5) OVER (ORDER BY v) AS fifth FROM x WHERE v IS NOT NULL),
           ranked AS (
             SELECT rank() OVER (ORDER BY v) + (count(*) OVER (PARTITION BY v) - 1) / 2.0 AS rv,
                    rank() OVER (ORDER BY score) + (count(*) OVER (PARTITION BY score) - 1) / 2.0 AS rs
             FROM q
           )
           SELECT fifth, count(*)::int AS hospitals, min(v) AS lo, max(v) AS hi, avg(score) AS "avgScore",
                  stddev_samp(score) / sqrt(count(*)) AS "se",
                  (SELECT corr(rv, rs) FROM ranked) AS spearman
           FROM q GROUP BY fifth ORDER BY fifth`
        )
      ),
    ])
    return {
      ...summary.rows[0],
      byOwnership: byOwnership.rows,
      vsPerformance: METRICS.map((m, i) => ({
        metric: camel(m),
        spearman: metricRows[i].rows[0]?.spearman ?? null,
        fifths: metricRows[i].rows.map(({ spearman: _s, ...q }) => q),
      })),
    }
  })
}
