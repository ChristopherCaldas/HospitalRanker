import { pool } from '../db/pool'

export interface HospitalSummary {
  id: string
  name: string
  city: string | null
  state: string | null
  hospitalType: string | null
  overallRating: number | null
}

const SUMMARY_COLUMNS = `facility_id AS id, name, city, state, hospital_type AS "hospitalType",
  overall_rating AS "overallRating"`

// Name/city search, optionally within a state. Prefix matches rank first.
export async function searchHospitals(q: string, state: string | null, limit = 20): Promise<HospitalSummary[]> {
  const term = q.trim()
  const { rows } = await pool.query<HospitalSummary>(
    `SELECT ${SUMMARY_COLUMNS} FROM hospitals
     WHERE ($1 = '' OR name ILIKE '%' || $1 || '%' OR city ILIKE $1 || '%')
       AND ($2::text IS NULL OR state = $2)
     ORDER BY (name ILIKE $1 || '%') DESC, name
     LIMIT $3`,
    [term, state, Math.min(Math.max(limit, 1), 50)]
  )
  return rows
}

export interface HospitalMeasure {
  category: string
  measureId: string
  name: string
  unit: string
  higherIsBetter: boolean
  score: number | null
  lowerEstimate: number | null
  higherEstimate: number | null
  cases: number | null
  comparedToNational: string | null
  footnote: string | null
  windowStart: string | null
  windowEnd: string | null
  statePercentile: number | null
  nationalPercentile: number | null
  stateHospitals: number | null
  stateMedian: number | null
  nationalMedian: number | null
}

export interface HospitalDetail extends HospitalSummary {
  address: string | null
  zipCode: string | null
  county: string | null
  phone: string | null
  ownership: string | null
  emergencyServices: boolean | null
  measures: HospitalMeasure[]
}

// One hospital with its score on every category measure (from the release
// the analysis used), its percentile within its state and nationally, and the
// state and national medians for context.
export async function getHospital(id: string): Promise<HospitalDetail | null> {
  const { rows: [hospital] } = await pool.query(
    `SELECT ${SUMMARY_COLUMNS}, address, zip_code AS "zipCode", county, phone, ownership,
            emergency_services AS "emergencyServices"
     FROM hospitals WHERE facility_id = $1`,
    [id]
  )
  if (!hospital) return null

  const { rows: measures } = await pool.query<HospitalMeasure>(
    `WITH medians AS (
       SELECT s.measure_id,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY s.score) AS national_median,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY s.score) FILTER (WHERE h.state = $2) AS state_median
       FROM analysis_measure_windows w
       JOIN measure_scores s ON s.measure_id = w.measure_id AND s.release_id = w.release_id AND s.score IS NOT NULL
       JOIN hospitals h ON h.facility_id = s.facility_id
       GROUP BY s.measure_id
     )
     SELECT m.category, m.measure_id AS "measureId", m.name, m.unit, m.higher_is_better AS "higherIsBetter",
            s.score::float8 AS score, s.lower_estimate::float8 AS "lowerEstimate",
            s.higher_estimate::float8 AS "higherEstimate", s.denominator AS cases,
            s.compared_to_national AS "comparedToNational", s.footnote,
            to_char(w.window_start, 'YYYY-MM-DD') AS "windowStart", to_char(w.window_end, 'YYYY-MM-DD') AS "windowEnd",
            p.state_percentile AS "statePercentile", p.national_percentile AS "nationalPercentile",
            p.state_hospitals::int AS "stateHospitals",
            md.state_median AS "stateMedian", md.national_median AS "nationalMedian"
     FROM measures m
     JOIN analysis_measure_windows w ON w.measure_id = m.measure_id
     LEFT JOIN measure_scores s ON s.measure_id = m.measure_id AND s.release_id = w.release_id AND s.facility_id = $1
     LEFT JOIN analysis_latest_hospital_percentiles p ON p.measure_id = m.measure_id AND p.facility_id = $1
     LEFT JOIN medians md ON md.measure_id = m.measure_id
     WHERE m.category IS NOT NULL
     ORDER BY m.category`,
    [id, hospital.state]
  )

  return { ...hospital, measures }
}
