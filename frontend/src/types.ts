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
  history: HospitalHistory
  notes: HospitalNote[]
  usNewsHonorRoll: boolean
  finance: HospitalFinance | null
  context: HospitalContext | null
  movers?: Partial<Record<Category, HospitalMover>>
}

// Whether a hospital clearly changed on a measure between two periods (Movers).
export interface HospitalMover {
  verdict: 'improved' | 'steady' | 'declined'
  from: string
  to: string
  change: number
  changeSe: number
}

export type FinanceMetric =
  | 'patientMargin' | 'totalMargin' | 'otherIncomeShare' | 'uncompensatedShare'
  | 'medicaidDayShare' | 'contractLaborShare' | 'ftePerBed' | 'occupancy'

// Latest Medicare cost report; shares are 0-1. Medians are national and for
// hospitals of the same type.
export interface HospitalFinance {
  fiscalYearBegin: string | null
  fiscalYearEnd: string
  beds: number | null
  netPatientRevenue: number | null
  otherIncome: number | null
  values: Record<FinanceMetric, number | null>
  nationalMedians: Record<FinanceMetric, number | null>
  typeMedians: Record<FinanceMetric, number | null>
}

export type ContextField =
  | 'dualProportion' | 'dshPct' | 'caseMixIndex' | 'residentBedRatio' | 'sviPercentile' | 'poverty150Pct' | 'uninsuredPct'

// What the expected-score model adjusts for, at the hospital level.
export interface HospitalContext {
  values: Record<ContextField, number | null> & { rural: boolean | null }
  nationalMedians: Record<ContextField, number | null>
}

export interface FinanceOverview {
  hospitals: number
  firstYearEnd: string
  lastYearEnd: string
  patientMargin: number
  totalMargin: number
  losingOnPatients: number
  losingOverall: number
  byOwnership: {
    ownership: string
    hospitals: number
    patientMargin: number | null
    totalMargin: number | null
    otherIncomeShare: number | null
    uncompensatedShare: number | null
    medicaidDayShare: number | null
    losingOverall: number
  }[]
  vsPerformance: {
    metric: FinanceMetric
    spearman: number | null
    fifths: { fifth: number; hospitals: number; lo: number; hi: number; avgScore: number; se: number }[]
  }[]
}

// Yearly scores for one measure, oldest first, with the national median for
// the same measurement period.
export interface HistoryPoint {
  start: string | null
  end: string
  score: number
  nationalMedian: number | null
}

export type HospitalHistory = Partial<Record<Category, HistoryPoint[]>>

export interface HospitalNote {
  kind: 'news' | 'recognition' | 'rating'
  summary: string
  source: string
  url: string
  published: string
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
  groups: number
  score: number
  scoreSe: number
  verdict: Verdict
  nationalRank: number
  stateRank: number
  overallRating: number | null
}

// Overall score, the two Donabedian domains, and the five CMS measure groups.
export type Scope = 'overall' | 'outcome' | 'process' | 'mortality' | 'safety' | 'readmission' | 'experience' | 'timely_effective'
export type QualityGroup = 'mortality' | 'safety' | 'readmission' | 'experience' | 'timely_effective'

export interface Leaderboard {
  scope: Scope
  groups: number | null
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

export interface ScopeScore {
  measures: number
  groups: number
  score: number
  scoreSe: number
  verdict: Verdict
  nationalRank: number
  nationalCount: number
}

// Every quality measure the expected model scored for one hospital.
export interface HospitalQualityMeasure {
  measureId: string
  name: string
  category: Category | null
  group: QualityGroup
  domain: 'process' | 'outcome'
  unit: string
  higherIsBetter: boolean
  actual: number
  expected: number
  gapSd: number // adjusted difference in units of the measure's real spread; positive = better
  verdict: Verdict
}

export interface HospitalPerformance {
  measures: { category: Category | null; expected: number; adjustedGap: number; gapSe: number; verdict: Verdict }[]
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
  scopes: Partial<Record<Scope, ScopeScore>>
  allMeasures: HospitalQualityMeasure[]
  // Rank on the unadjusted overall score among hospitals in the same fifth of dual-eligible share.
  peer: { fifth: number; peerRank: number; peerCount: number; dualLow: number; dualHigh: number } | null
}

export interface ChainTest {
  link: 'structure_process' | 'structure_outcome' | 'process_outcome' | 'pair'
  x: string
  y: string
  n: number
  r: number | null
  rCiLow: number | null
  rCiHigh: number | null
  spearman: number | null
  partialR: number | null
  qValue: number | null
  topFifth: number | null
  bottomFifth: number | null
}

export interface ChainOverview {
  runCreatedAt: string
  tests: ChainTest[]
}

export type MoneyMetric = 'patient_margin' | 'total_margin' | 'uncompensated' | 'other_income' | 'cost_per_discharge'
  | 'fte_per_bed' | 'salary_per_fte' | 'contract_labor'

export interface EquityFifth {
  fifth: number
  dualLow: number
  dualHigh: number
  hospitals: number
  scores: Record<Scope, { raw: number | null; adjusted: number | null; n: number }>
  money: Record<MoneyMetric, { median: number | null; n: number }>
  within: Record<MoneyMetric, { spearman: number | null; n: number }>
  medianMspb: number | null
}

export interface EquityOverview {
  fifths: EquityFifth[]
}

export interface ValueHospital {
  id: string
  name: string
  city: string | null
  state: string
  mspb: number
  outcome: number
  verdict: Verdict
}

export interface ValueFifth {
  fifth: number
  hospitals: number
  lo: number
  hi: number
  avgOutcome: number
  se: number
}

export interface ValueOverview {
  windowStart: string
  windowEnd: string
  hospitals: number
  medianMspb: number
  p10Mspb: number
  p90Mspb: number
  medianCostAdj: number | null
  spearmanMspbOutcome: number | null
  spearmanCostOutcome: number | null
  spearmanMspbCost: number | null
  quadrants: { betterCheaper: number; betterCostlier: number; worseCheaper: number; worseCostlier: number }
  mspbFifths: ValueFifth[]
  costFifths: ValueFifth[]
  highValue: ValueHospital[]
  lowValue: ValueHospital[]
}

export interface SpotlightHospital extends LeaderboardRow {
  usNewsHonorRoll: boolean
  breakdown: {
    category: Category
    unit: string
    higherIsBetter: boolean
    actual: number
    expected: number
    gapSd: number // adjusted difference in units of the measure's real spread; positive = better
    verdict: Verdict
  }[]
  history: HospitalHistory
  notes: HospitalNote[]
}

export interface Spotlight {
  hospitals: number
  notesChecked: string
  top: SpotlightHospital[]
  bottom: SpotlightHospital[]
}

export interface Benchmarks {
  ranked: number
  stars: {
    byRating: { stars: number | null; hospitals: number; avgScore: number; medianRank: number; better: number; worse: number }[]
    spearman: number
    hospitals: number
  }
  usNewsHonorRoll: {
    edition: string
    published: string
    url: string
    hospitals: {
      id: string
      name: string
      city: string | null
      state: string
      nationalRank: number | null
      score: number | null
      verdict: Verdict | null
      weakest: { category: Category; unit: string; actual: number; expected: number; gapSd: number } | null
    }[]
  }
}

// "What predicts hospital results?" (GET /api/predictors). Shares are
// cross-validated R^2 (0-1); r is oriented so + = goes with better scores.
export interface PersistencePoint {
  periodStart: string | null
  periodEnd: string
  yearsBack: number
  overlapping: boolean
  r: number
  n: number
}

export interface MeasurePredictors {
  measureId: string
  category: Category
  higherIsBetter: boolean
  hospitals: number
  groups: Record<string, { alone: number; added: number }>
  variables: Record<string, { r: number; n: number; coverage: number }>
  models: Record<'assumptions' | 'fair_context' | 'everything_known' | 'with_track_record', number>
  noiseShare: number | null
  persistence: PersistencePoint[]
}

export interface PredictorsOverview {
  runId: number | null
  computedAt: string | null
  measures: MeasurePredictors[]
  correlations: { a: string; b: string; r: number; n: number }[]
}

// "Movers" (GET /api/movers): real change between two periods after noise and
// regression to the mean. Changes are oriented so + = better.
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
  category: Category
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
