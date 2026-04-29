import axios from 'axios'
import { getCached, setCache } from '../db/cache'

const CMS_BASE = 'https://data.cms.gov/provider-data/api/1/datastore/query'

// CMS Provider Data Catalog dataset IDs
const DATASETS = {
  timely_care: 'yv7e-xc69',
  complications: 'ynj2-r877',
  hcahps: 'dgck-syfz',
  readmissions: '632h-zaca',
} as const

export const MEASURE_MAP: Record<
  string,
  { dataset: keyof typeof DATASETS; measureId: string; higherIsBetter: boolean; measureIdField?: string; scoreField?: string }
> = {
  wait_times:   { dataset: 'timely_care',   measureId: 'OP_18b',              higherIsBetter: false },
  mortality:    { dataset: 'complications', measureId: 'MORT_30_AMI',         higherIsBetter: false },
  safety:       { dataset: 'complications', measureId: 'PSI_90',              higherIsBetter: false },
  satisfaction: { dataset: 'hcahps',        measureId: 'H_COMP_1_STAR_RATING', higherIsBetter: true, measureIdField: 'hcahps_measure_id', scoreField: 'patient_survey_star_rating' },
  readmission:  { dataset: 'readmissions',  measureId: 'Hybrid_HWR',          higherIsBetter: false },
}

export interface CMSRecord {
  facility_id: string
  facility_name: string
  citytown: string
  state: string
  score: string
}

export async function fetchMeasure(category: string): Promise<CMSRecord[]> {
  const cacheKey = `cms_${category}`
  const cached = getCached<CMSRecord[]>(cacheKey)
  if (cached) return cached

  const measure = MEASURE_MAP[category]
  if (!measure) throw new Error(`Unknown category: ${category}`)

  const measureIdField = measure.measureIdField ?? 'measure_id'
  const scoreField = measure.scoreField ?? 'score'

  const allResults: Record<string, string>[] = []
  let offset = 0
  let total = Infinity

  while (offset < total) {
    const res = await axios.post(`${CMS_BASE}/${DATASETS[measure.dataset]}/0`, {
      conditions: [
        { property: measureIdField, value: measure.measureId, operator: '=' },
      ],
      limit: 500,
      offset,
    })
    total = res.data.count ?? 0
    allResults.push(...(res.data.results ?? []))
    offset += 500
  }

  const records: CMSRecord[] = allResults
    .filter((r: Record<string, string>) => {
      const s = r[scoreField]
      return s && s !== 'Not Available' && s !== 'Not Applicable'
    })
    .map((r: Record<string, string>) => ({
      facility_id: r.facility_id,
      facility_name: r.facility_name,
      citytown: r.citytown,
      state: r.state,
      score: r[scoreField],
    }))

  setCache(cacheKey, records)
  return records
}
