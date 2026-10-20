export interface Hospital {
  id: string
  name: string
  city: string
  state: string
  score: number | null
  lowerEstimate: number | null
  higherEstimate: number | null
  cases: number | null
  comparedToNational: string | null
}

export interface CategoryRanking {
  category: string
  label: string
  description: string
  technicalDescription: string
  top5: Hospital[]
  bottom5: Hospital[]
  nationalMedian: number
  scoredHospitals: number
  higherIsBetter: boolean
  unit: string
  hasCaseCounts: boolean
  minCases: number
  measureId: string
  released: string | null
  periodStart: string | null
  periodEnd: string | null
}

export type Category = 'wait_times' | 'mortality' | 'safety' | 'satisfaction' | 'readmission'

export type Factor =
  | 'inpatient_occupancy'
  | 'icu_occupancy'
  | 'resp_admissions_per_100_beds'
  | 'stdzd_spend_pc'
  | 'ip_stdzd_spend_pc'

export interface StateRow {
  state: string
  hospitals: number
  cases: number | null
  outcome: number
  inpatientOccupancy: number | null
  icuOccupancy: number | null
  respAdmissionsPer100Beds: number | null
  stdzdSpendPc: number | null
  ipStdzdSpendPc: number | null
  maParticipationRate: number | null
  dualEligiblePct: number | null
  weeksUsed: number | null
  weeksInWindow: number | null
}

export interface Correlation {
  factor: Factor
  n: number
  r: number
  rCiLow: number | null
  rCiHigh: number | null
  spearman: number
  partialR: number | null
  partialCiLow: number | null
  partialCiHigh: number | null
  partialQ: number | null
  slope: number
  intercept: number
}

export interface StateAnalysis {
  category: Category
  label: string
  runId: number
  runCreatedAt: string
  measureId: string
  higherIsBetter: boolean
  unit: string
  windowStart: string
  windowEnd: string
  nationalOutcome: number
  states: StateRow[]
  correlations: Correlation[]
}

export interface HospitalSummary {
  id: string
  name: string
  city: string | null
  state: string | null
  hospitalType: string | null
  overallRating: number | null
}

export interface HospitalMeasure {
  category: Category
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
  performance: HospitalPerformance
}

export type Verdict = 'better' | 'as_expected' | 'worse'

export interface ContextSummary {
  category: Category
  label: string
  measureId: string
  unit: string
  higherIsBetter: boolean
  method: string
  hospitals: number
  r2Cv: number
  importance: Record<string, number>
  coefficients: Record<string, { estimate: number; se: number }>
  rankAgreement: number
  tau: number
  better: number
  worse: number
}

export interface LeaderboardRow {
  id: string
  name: string
  city: string | null
  state: string
  hospitalType: string | null
  measures: number
  score: number
  scoreSe: number
  verdict: Verdict
  nationalRank: number
  stateRank: number
}

export interface Leaderboard {
  hospitals: number
  better: number
  worse: number
  top: LeaderboardRow[]
  bottom: LeaderboardRow[]
}

export interface MeasurePerformanceRow {
  id: string
  name: string
  city: string | null
  state: string
  actual: number
  expected: number
  gap: number
  adjustedGap: number
  gapSe: number
  verdict: Verdict
}

export interface MeasurePerformance {
  category: Category
  label: string
  measureId: string
  unit: string
  higherIsBetter: boolean
  over: MeasurePerformanceRow[]
  under: MeasurePerformanceRow[]
}

export interface HospitalPerformance {
  measures: { category: Category; expected: number; adjustedGap: number; gapSe: number; verdict: Verdict }[]
  overall: {
    measures: number
    score: number
    scoreSe: number
    verdict: Verdict
    nationalRank: number
    stateRank: number
    nationalCount: number
    stateCount: number
  } | null
}
