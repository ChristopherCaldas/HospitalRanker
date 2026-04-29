import { Router } from 'express'
import type { Request, Response } from 'express'
import { fetchMeasure, MEASURE_MAP } from '../services/cms'
import { getQuips } from '../services/quips'

const router = Router()

const CATEGORY_META: Record<string, { label: string; description: string; technicalDescription: string }> = {
  wait_times: {
    label: 'ER Wait Times',
    description: 'Median minutes from arrival to being seen by a provider in the emergency department.',
    technicalDescription: 'Measure OP_18b from the CMS Timely and Effective Care dataset. It captures the median time (in minutes) between a patient\'s arrival in the ED and the moment a qualified provider initiates an evaluation. Scores are derived from claims and hospital-reported data; lower values indicate faster triage and better throughput. Hospitals with very high volumes or trauma designations may skew higher independent of care quality.',
  },
  mortality: {
    label: '30-Day Mortality',
    description: '30-day mortality rate for heart attack patients. Lower is better — for obvious reasons.',
    technicalDescription: 'Measure MORT_30_AMI from the CMS Complications and Deaths dataset. It reports the risk-standardized mortality rate (RSMR) for patients admitted with acute myocardial infarction, tracking deaths from any cause within 30 days of admission. CMS adjusts for patient-level risk factors including age, comorbidities, and prior hospitalizations using a hierarchical logistic regression model, so scores are comparable across hospitals with different patient populations.',
  },
  safety: {
    label: 'Patient Safety',
    description: 'Composite patient safety indicator score tracking serious in-hospital complications.',
    technicalDescription: 'Measure PSI_90 from the CMS Complications and Deaths dataset, based on AHRQ\'s Patient Safety Indicators. It is a weighted composite of 10 PSI components covering adverse events such as pressure ulcers, post-operative sepsis, accidental puncture or laceration, and iatrogenic pneumothorax. The score is risk-adjusted and expressed as a ratio relative to the national expected rate — values below 1.0 indicate fewer complications than expected, above 1.0 indicates more.',
  },
  satisfaction: {
    label: 'Patient Satisfaction',
    description: 'HCAHPS star rating based on patient surveys. A rare case where the customer is always right.',
    technicalDescription: 'Measure H_COMP_1_STAR_RATING from the CMS HCAHPS (Hospital Consumer Assessment of Healthcare Providers and Systems) dataset. This star rating (1–5) summarises how often patients reported that nurses communicated well during their stay, derived from three standardised survey questions covering listening, explaining, and treating patients with courtesy. Survey responses are adjusted for patient mix and mode of survey administration before being converted to a star rating.',
  },
  readmission: {
    label: 'Readmission Rate',
    description: '30-day hospital-wide unplanned readmission rate. Lower means you fixed it the first time.',
    technicalDescription: 'Measure Hybrid_HWR from the CMS Unplanned Hospital Visits dataset. The Hospital-Wide Readmission measure uses a hybrid methodology combining Medicare claims data with electronic health record data to calculate the rate of unplanned readmissions within 30 days of discharge across all eligible conditions. Risk adjustment accounts for patient demographics, principal diagnosis, and relevant comorbidities. Scores are expressed as a percentage; the national average is roughly 15%.',
  },
}

router.get('/:category', async (req: Request, res: Response) => {
  const { category } = req.params
  const meta = CATEGORY_META[category]

  if (!meta) {
    res.status(404).json({ error: 'Unknown category' })
    return
  }

  try {
    const records = await fetchMeasure(category)
    const measureInfo = MEASURE_MAP[category]

    const sorted = [...records].sort((a, b) => {
      const aScore = parseFloat(a.score)
      const bScore = parseFloat(b.score)
      return measureInfo.higherIsBetter ? bScore - aScore : aScore - bScore
    })

    const toHospital = (r: (typeof records)[0]) => ({
      id: r.facility_id,
      name: r.facility_name,
      city: r.citytown,
      state: r.state,
      score: parseFloat(r.score),
    })

    const top5 = sorted.slice(0, 5).map(toHospital)
    const bottom5 = sorted.slice(-5).reverse().map(toHospital)
    const quips = getQuips(category)

    res.json({
      category,
      label: meta.label,
      description: meta.description,
      technicalDescription: meta.technicalDescription,
      top5,
      bottom5,
      bestQuip: quips.best,
      worstQuip: quips.worst,
      higherIsBetter: measureInfo.higherIsBetter,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch rankings' })
  }
})

export default router
