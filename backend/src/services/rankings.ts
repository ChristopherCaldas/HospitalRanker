import { pool } from '../db/pool'

export interface RankedHospital {
  id: string
  name: string
  city: string | null
  state: string | null
  score: number
}

export interface MeasureRanking {
  measureId: string
  higherIsBetter: boolean
  released: string | null
  periodStart: string | null
  periodEnd: string | null
  top5: RankedHospital[]
  bottom5: RankedHospital[]
}

// Ranks the measure behind `category` using the newest complete release that
// actually has scores for it, so a release where CMS suppressed the measure
// falls back to the previous one. Ties break toward the hospital with more
// cases, then by name, so the order is stable between requests.
export async function getRanking(category: string): Promise<MeasureRanking | null> {
  const { rows: [measure] } = await pool.query<{ measure_id: string; higher_is_better: boolean }>(
    'SELECT measure_id, higher_is_better FROM measures WHERE category = $1',
    [category]
  )
  if (!measure) return null

  const { rows: [release] } = await pool.query<{
    release_id: number
    released: string | null
    period_start: string | null
    period_end: string | null
  }>(
    `SELECT s.release_id, to_char(r.released, 'YYYY-MM-DD') AS released,
            to_char(min(s.start_date), 'YYYY-MM-DD') AS period_start,
            to_char(max(s.end_date), 'YYYY-MM-DD') AS period_end
     FROM measure_scores s JOIN cms_releases r ON r.id = s.release_id
     WHERE s.measure_id = $1 AND s.score IS NOT NULL AND r.status = 'complete'
     GROUP BY s.release_id, r.released, r.id
     ORDER BY r.released DESC NULLS LAST, r.id DESC
     LIMIT 1`,
    [measure.measure_id]
  )
  if (!release) return null

  const ranked = (direction: 'ASC' | 'DESC') => `
    SELECT h.facility_id AS id, h.name, h.city, h.state, s.score::float8 AS score
    FROM measure_scores s JOIN hospitals h USING (facility_id)
    WHERE s.measure_id = $1 AND s.release_id = $2 AND s.score IS NOT NULL
    ORDER BY s.score ${direction}, s.denominator DESC NULLS LAST, h.name
    LIMIT 5`
  const params = [measure.measure_id, release.release_id]
  const [top, bottom] = await Promise.all([
    pool.query<RankedHospital>(ranked(measure.higher_is_better ? 'DESC' : 'ASC'), params),
    pool.query<RankedHospital>(ranked(measure.higher_is_better ? 'ASC' : 'DESC'), params),
  ])

  return {
    measureId: measure.measure_id,
    higherIsBetter: measure.higher_is_better,
    released: release.released,
    periodStart: release.period_start,
    periodEnd: release.period_end,
    top5: top.rows,
    bottom5: bottom.rows,
  }
}
