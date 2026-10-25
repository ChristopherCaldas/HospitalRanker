import { pool } from '../db/pool'

// Extras for the in-depth hospital profile, on top of the hospital detail:
// its health system and sibling hospitals, what Medicare spends around its
// stays (MSPB), what it spends itself, and its standing in its state on each
// score.

export interface ProfileExtras {
  system: { name: string; hospitals: { id: string; name: string; city: string | null; state: string }[] } | null
  mspb: { value: number; nationalMedian: number; stateMedian: number | null; windowStart: string; windowEnd: string } | null
  cost: {
    costPerCase: number | null // cost per discharge / case mix index
    salaryPerFte: number | null
    nationalCostPerCase: number | null
    nationalSalaryPerFte: number | null
  }
  stateRanks: Record<string, { stateRank: number; stateCount: number }>
}

export async function getProfileExtras(id: string): Promise<ProfileExtras | null> {
  const { rows: [h] } = await pool.query<{ state: string; system_id: string | null; system_name: string | null }>(
    `SELECT h.state, c.system_id, c.system_name
     FROM hospitals h LEFT JOIN hospital_context c USING (facility_id) WHERE h.facility_id = $1`,
    [id]
  )
  if (!h) return null

  const [siblings, mspb, cost, ranks] = await Promise.all([
    h.system_id
      ? pool.query(
          `SELECT h.facility_id AS id, h.name, h.city, h.state
           FROM hospital_context c JOIN hospitals h USING (facility_id)
           WHERE c.system_id = $1 ORDER BY h.state, h.name`,
          [h.system_id]
        )
      : Promise.resolve({ rows: [] }),
    pool.query(
      `SELECT max(score) FILTER (WHERE facility_id = $1)::float8 AS value,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY score)::float8 AS "nationalMedian",
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY score) FILTER (WHERE h.state = $2))::float8 AS "stateMedian",
              to_char(min(start_date), 'YYYY-MM-DD') AS "windowStart", to_char(max(end_date), 'YYYY-MM-DD') AS "windowEnd"
       FROM latest_measure_scores s JOIN hospitals h USING (facility_id)
       WHERE s.measure_id = 'MSPB-1' AND s.score IS NOT NULL`,
      [id, h.state]
    ),
    // Same plausibility bounds as elsewhere: pay $20k-$400k, cost per case > 0.
    pool.query(
      `WITH x AS (
         SELECT r.facility_id,
                CASE WHEN r.cost_per_discharge > 0 AND c.case_mix_index > 0 THEN r.cost_per_discharge / c.case_mix_index END AS cost_per_case,
                CASE WHEN r.salary_per_fte BETWEEN 20000 AND 400000 THEN r.salary_per_fte END AS salary
         FROM hospital_finance_ratios r LEFT JOIN hospital_context c USING (facility_id)
       )
       SELECT max(cost_per_case) FILTER (WHERE facility_id = $1)::float8 AS "costPerCase",
              max(salary) FILTER (WHERE facility_id = $1)::float8 AS "salaryPerFte",
              percentile_cont(0.5) WITHIN GROUP (ORDER BY cost_per_case)::float8 AS "nationalCostPerCase",
              percentile_cont(0.5) WITHIN GROUP (ORDER BY salary)::float8 AS "nationalSalaryPerFte"
       FROM x`,
      [id]
    ),
    pool.query<{ scope: string; stateRank: number; stateCount: number }>(
      `SELECT scope, state_rank AS "stateRank", "stateCount"
       FROM (SELECT *, count(*) OVER (PARTITION BY scope, state)::int AS "stateCount" FROM analysis_latest_hospital_scores) s
       WHERE facility_id = $1`,
      [id]
    ),
  ])

  const m = mspb.rows[0]
  return {
    system: h.system_name ? { name: h.system_name, hospitals: siblings.rows } : null,
    mspb: m?.value === null || m?.value === undefined ? null : m,
    cost: cost.rows[0],
    stateRanks: Object.fromEntries(ranks.rows.map(({ scope, ...r }) => [scope, r])),
  }
}
