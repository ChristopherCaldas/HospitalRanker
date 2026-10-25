import { Client } from 'pg'
import { CsvRow, ScoreRow } from './datasets'
import { toText } from './parse'

// Shared by the live (index.ts) and archive (archive.ts) ingesters.
export async function insertScores(db: Client, releaseId: number, csvRows: CsvRow[], scores: ScoreRow[]): Promise<void> {
  // A measure file can list a facility missing from General Information;
  // give it a minimal hospitals row so the foreign key holds.
  await db.query(
    `INSERT INTO hospitals (facility_id, name, city, state)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
     ON CONFLICT (facility_id) DO NOTHING`,
    [
      csvRows.map(r => r['Facility ID'].trim()), csvRows.map(r => toText(r['Facility Name'])),
      csvRows.map(r => toText(r['City/Town'])), csvRows.map(r => toText(r['State'])),
    ]
  )
  await db.query('DELETE FROM measure_scores WHERE release_id = $1', [releaseId])
  const kept = newestPerMeasure(scores)
  const col = <K extends keyof ScoreRow>(key: K) => kept.map(s => s[key])
  await db.query(
    `INSERT INTO measure_scores (release_id, facility_id, measure_id, score, lower_estimate, higher_estimate,
                                 denominator, compared_to_national, footnote, start_date, end_date)
     SELECT $1, * FROM unnest($2::text[], $3::text[], $4::numeric[], $5::numeric[], $6::numeric[],
                              $7::integer[], $8::text[], $9::text[], $10::date[], $11::date[])`,
    [
      releaseId, col('facility_id'), col('measure_id'), col('score'), col('lower_estimate'),
      col('higher_estimate'), col('denominator'), col('compared_to_national'), col('footnote'),
      col('start_date'), col('end_date'),
    ]
  )
}

// Some files list a measure twice for a hospital (the 2021 snapshot has two
// flu seasons of IMM_3); keep the row with the latest period end.
export function newestPerMeasure(scores: ScoreRow[]): ScoreRow[] {
  const best = new Map<string, ScoreRow>()
  for (const s of scores) {
    const key = `${s.facility_id} ${s.measure_id}`
    const prior = best.get(key)
    if (!prior || (s.end_date ?? '') > (prior.end_date ?? '')) best.set(key, s)
  }
  return [...best.values()]
}
