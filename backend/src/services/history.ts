import { pool } from '../db/pool'

// Yearly score history per hospital (migrations/009, ingest/archive.ts), with
// the national median for each measurement period so a trend can be read
// against shifts that hit every hospital (e.g. a CMS method change).

export interface HistoryPoint {
  start: string | null
  end: string
  score: number
  nationalMedian: number | null
}

// category -> points, oldest first
export type HospitalHistory = Record<string, HistoryPoint[]>

// National medians change only when data is ingested (monthly at most), and
// computing them scans every stored release, so they are cached briefly.
const MEDIAN_TTL_MS = 60 * 60 * 1000
let medianCache: { at: number; value: Promise<Map<string, number>> } | null = null

export function clearHistoryCache(): void {
  medianCache = null
}

function nationalMedians(): Promise<Map<string, number>> {
  if (medianCache && Date.now() - medianCache.at < MEDIAN_TTL_MS) return medianCache.value
  const value = pool
    .query<{ measure_id: string; end: string; median: number }>(
      `SELECT h.measure_id, to_char(h.end_date, 'YYYY-MM-DD') AS "end",
              percentile_cont(0.5) WITHIN GROUP (ORDER BY h.score) AS median
       FROM measure_score_history h JOIN measures m USING (measure_id)
       WHERE m.category IS NOT NULL
       GROUP BY h.measure_id, h.end_date`
    )
    .then(({ rows }) => new Map(rows.map(r => [`${r.measure_id} ${r.end}`, r.median])))
  value.catch(() => clearHistoryCache())
  medianCache = { at: Date.now(), value }
  return value
}

export async function getHistories(ids: string[]): Promise<Record<string, HospitalHistory>> {
  const out: Record<string, HospitalHistory> = Object.fromEntries(ids.map(id => [id, {}]))
  if (ids.length === 0) return out
  const [medians, { rows }] = await Promise.all([
    nationalMedians(),
    pool.query<{ id: string; category: string; measure_id: string; start: string | null; end: string; score: number }>(
      `SELECT h.facility_id AS id, m.category, h.measure_id,
              to_char(h.start_date, 'YYYY-MM-DD') AS start, to_char(h.end_date, 'YYYY-MM-DD') AS "end",
              h.score::float8 AS score
       FROM measure_score_history h JOIN measures m USING (measure_id)
       WHERE h.facility_id = ANY($1) AND m.category IS NOT NULL
       ORDER BY h.end_date`,
      [ids]
    ),
  ])
  for (const r of rows) {
    const series = (out[r.id][r.category] ??= [])
    series.push({ start: r.start, end: r.end, score: r.score, nationalMedian: medians.get(`${r.measure_id} ${r.end}`) ?? null })
  }
  return out
}
