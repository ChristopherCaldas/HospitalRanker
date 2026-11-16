import { pool } from '../db/pool'
import type { Scope } from './performance'

// "Near you": every hospital within a radius of a ZIP code or a point, with
// its score on one scope of analysis_hospital_scores. Hospitals sit at their
// ZIP's Census point (zip_points), so distances are approximate.

export const MAX_MILES = 100

type Query = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }

export interface Origin {
  lat: number
  lon: number
  zip: string        // the ZIP searched, or the nearest one to a point
  approximate: boolean // ZIP not in the Gazetteer (PO boxes, new ZIPs): its 3-digit area's center
}

export interface NearbyHospital {
  id: string
  name: string
  city: string | null
  state: string | null
  hospitalType: string | null
  emergencyServices: boolean | null
  overallRating: number | null
  miles: number
  score: number | null
  scoreSe: number | null
  verdict: 'better' | 'as_expected' | 'worse' | null
  measures: number | null
  groups: number | null
  overallGroups: number | null // measure groups behind the overall score: 5 = full-service
}

export async function originFromZip(zip: string, db: Query = pool): Promise<Origin | null> {
  const { rows: [exact] } = await db.query('SELECT lat, lon FROM zip_points WHERE zip = $1', [zip])
  if (exact) return { lat: exact.lat, lon: exact.lon, zip, approximate: false }
  const { rows: [area] } = await db.query(
    'SELECT avg(lat) AS lat, avg(lon) AS lon FROM zip_points WHERE left(zip, 3) = $1 HAVING count(*) > 0',
    [zip.slice(0, 3)]
  )
  return area ? { lat: Number(area.lat), lon: Number(area.lon), zip, approximate: true } : null
}

// A visitor's position becomes its nearest ZIP for display, so the page never
// has to echo coordinates back.
export async function originFromPoint(lat: number, lon: number, db: Query = pool): Promise<Origin | null> {
  const { rows: [z] } = await db.query(
    `SELECT zip FROM zip_points
     WHERE lat BETWEEN $1::float8 - 1 AND $1::float8 + 1
     ORDER BY (lat - $1::float8) ^ 2 + ((lon - $2::float8) * cos(radians($1::float8))) ^ 2 LIMIT 1`,
    [lat, lon]
  )
  return z ? { lat, lon, zip: z.zip, approximate: false } : null
}

// Best first; unscored hospitals last, nearest first.
export async function nearbyHospitals(origin: Origin, miles: number, scope: Scope, db: Query = pool): Promise<NearbyHospital[]> {
  const { rows } = await db.query(
    `WITH near AS (
       SELECT p.facility_id,
              3958.8 * 2 * asin(least(1, sqrt(sin(radians(p.lat - $1) / 2) ^ 2
                + cos(radians($1)) * cos(radians(p.lat)) * sin(radians(p.lon - $2) / 2) ^ 2))) AS miles
       FROM hospital_points p
       WHERE p.lat BETWEEN $1::float8 - $3::float8 / 69.0 AND $1::float8 + $3::float8 / 69.0
     )
     SELECT h.facility_id AS id, h.name, h.city, h.state, h.hospital_type AS "hospitalType",
            h.emergency_services AS "emergencyServices", h.overall_rating AS "overallRating",
            n.miles, s.score, s.score_se AS "scoreSe", s.verdict, s.measures, s.groups, o.groups AS "overallGroups"
     FROM near n
     JOIN hospitals h USING (facility_id)
     LEFT JOIN analysis_latest_hospital_scores s ON s.facility_id = n.facility_id AND s.scope = $4::text
     LEFT JOIN analysis_latest_hospital_scores o ON o.facility_id = n.facility_id AND o.scope = 'overall'
     WHERE n.miles <= $3::float8
     ORDER BY s.score DESC NULLS LAST, n.miles, h.name`,
    [origin.lat, origin.lon, miles, scope]
  )
  return rows.map(r => ({ ...r, miles: Math.round(Number(r.miles) * 10) / 10 }))
}
