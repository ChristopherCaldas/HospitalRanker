// Display metadata for each ranking category. The measure behind a category
// lives in the `measures` table.
export const CATEGORY_META: Record<string, { label: string; description: string; technicalDescription: string }> = {
  wait_times: {
    label: 'ER Wait Times',
    description: 'Median minutes patients spend in the emergency department before leaving.',
    technicalDescription: 'Measure OP_18b from the CMS Timely and Effective Care dataset. It captures the median time (in minutes) from a patient\'s arrival in the ED to their departure, excluding patients transferred to another facility and psychiatric/mental health patients. Lower values indicate faster throughput. Hospitals with very high volumes or trauma designations may skew higher independent of care quality.',
  },
  mortality: {
    label: '30-Day Mortality',
    description: '30-day mortality rate for heart attack patients.',
    technicalDescription: 'Measure MORT_30_AMI from the CMS Complications and Deaths dataset. It reports the risk-standardized mortality rate (RSMR) for patients admitted with acute myocardial infarction, tracking deaths from any cause within 30 days of admission. CMS adjusts for patient-level risk factors including age, comorbidities, and prior hospitalizations using a hierarchical logistic regression model, so scores are comparable across hospitals with different patient populations.',
  },
  safety: {
    label: 'Patient Safety',
    description: 'Composite patient safety indicator score tracking serious in-hospital complications.',
    technicalDescription: 'Measure PSI_90 from the CMS Complications and Deaths dataset, based on AHRQ\'s Patient Safety Indicators. It is a weighted composite of 10 PSI components covering adverse events such as pressure ulcers, post-operative sepsis, accidental puncture or laceration, and iatrogenic pneumothorax. The score is risk-adjusted and expressed as a ratio relative to the national expected rate — values below 1.0 indicate fewer complications than expected, above 1.0 indicates more.',
  },
  satisfaction: {
    label: 'Patient Satisfaction',
    description: 'HCAHPS nurse-communication star rating from patient surveys.',
    technicalDescription: 'Measure H_COMP_1_STAR_RATING from the CMS HCAHPS (Hospital Consumer Assessment of Healthcare Providers and Systems) dataset. This star rating (1–5) summarises how often patients reported that nurses communicated well during their stay, derived from three standardised survey questions covering listening, explaining, and treating patients with courtesy. Survey responses are adjusted for patient mix and mode of survey administration before being converted to a star rating.',
  },
  readmission: {
    label: 'Readmission Rate',
    description: '30-day unplanned readmission rate for heart failure patients.',
    technicalDescription: 'Measure READM_30_HF from the CMS Unplanned Hospital Visits dataset. It reports the risk-standardized rate at which Medicare patients hospitalized for heart failure are readmitted for any cause within 30 days of discharge. CMS adjusts for age, comorbidities and prior hospitalizations with a hierarchical logistic regression model, so rates are comparable across hospitals with different patient mixes. (The hospital-wide Hybrid_HWR measure used previously was suppressed by CMS in the September 2026 release.)',
  },
}
