import { pool } from '../db/pool'
import { getHistories, type HistoryPoint } from './history'

// "Movers" (analysis/movers.ts), latest run: per measure, how much hospitals
// really changed between two periods, the hospitals that clearly improved or
// declined (with their score history), and what predicts change.

export interface Mover {
  facilityId: string
  name: string
  city: string | null
  state: string | null
  startScore: number
  endScore: number
  expectedEnd: number
  change: number
  changeSe: number
  verdict: 'improved' | 'declined'
  ownershipChange: boolean
  history: HistoryPoint[]
}

export interface MeasureMovers {
  measureId: string
  category: string
  unit: string
  higherIsBetter: boolean
  from: { start: string; end: string }
  to: { start: string; end: string }
  hospitals: number
  rtmSlope: number
  tau: number
  improved: number
  declined: number
  detectable: number
  rawJumps: number
  rawDrops: number
  fifths: { fifth: number; hospitals: number; avgChange: number; se: number }[]
  predictors: { groups: Record<string, { alone: number; added: number }>; variables: Record<string, { r: number; n: number }>; everything: number }
  ownership: { hospitals: number; effect: number; se: number; improved: number; declined: number }
  movers: Mover[]
}

export async function getMovers(): Promise<MeasureMovers[]> {
  const [models, movers] = await Promise.all([
    pool.query(`
      SELECT a.measure_id, m.category, m.unit, m.higher_is_better,
             lower(a.start_period)::text AS from_start, (upper(a.start_period) - 1)::text AS from_end,
             lower(a.end_period)::text AS to_start, (upper(a.end_period) - 1)::text AS to_end,
             a.hospitals, a.rtm_slope, a.tau, a.improved, a.declined, a.detectable, a.raw_jumps, a.raw_drops,
             a.fifths, a.predictors, a.ownership
      FROM analysis_latest_mover_models a JOIN measures m USING (measure_id)
      WHERE m.category IS NOT NULL ORDER BY a.measure_id`),
    pool.query(`
      SELECT v.measure_id, v.facility_id, h.name, h.city, h.state, v.start_score, v.end_score, v.expected_end,
             v.change, v.change_se, v.verdict, v.ownership_change
      FROM analysis_latest_movers v JOIN hospitals h USING (facility_id)
      WHERE v.verdict <> 'steady'
      ORDER BY v.measure_id, abs(v.change / NULLIF(v.change_se, 0)) DESC`),
  ])
  const histories = await getHistories([...new Set(movers.rows.map(r => r.facility_id as string))])
  return models.rows.map(m => ({
    measureId: m.measure_id,
    category: m.category,
    unit: m.unit,
    higherIsBetter: m.higher_is_better,
    from: { start: m.from_start, end: m.from_end },
    to: { start: m.to_start, end: m.to_end },
    hospitals: m.hospitals,
    rtmSlope: m.rtm_slope,
    tau: m.tau,
    improved: m.improved,
    declined: m.declined,
    detectable: m.detectable,
    rawJumps: m.raw_jumps,
    rawDrops: m.raw_drops,
    fifths: m.fifths,
    predictors: m.predictors,
    ownership: m.ownership,
    movers: movers.rows
      .filter(r => r.measure_id === m.measure_id)
      .map(r => ({
        facilityId: r.facility_id, name: r.name, city: r.city, state: r.state,
        startScore: r.start_score, endScore: r.end_score, expectedEnd: r.expected_end,
        change: r.change, changeSe: r.change_se, verdict: r.verdict, ownershipChange: r.ownership_change,
        history: histories[r.facility_id]?.[m.category] ?? [],
      })),
  }))
}

// One hospital's change verdict per category, for its page.
export async function getHospitalMovers(id: string): Promise<Record<string, { verdict: string; from: string; to: string; change: number; changeSe: number }>> {
  const { rows } = await pool.query(`
    SELECT m.category, v.verdict, upper(a.start_period) - 1 AS from_end, upper(a.end_period) - 1 AS to_end, v.change, v.change_se
    FROM analysis_latest_movers v
    JOIN analysis_latest_mover_models a USING (measure_id)
    JOIN measures m USING (measure_id)
    WHERE v.facility_id = $1 AND m.category IS NOT NULL`, [id])
  return Object.fromEntries(rows.map(r => [r.category, {
    verdict: r.verdict,
    from: new Date(r.from_end).toISOString().slice(0, 10),
    to: new Date(r.to_end).toISOString().slice(0, 10),
    change: r.change,
    changeSe: r.change_se,
  }]))
}
