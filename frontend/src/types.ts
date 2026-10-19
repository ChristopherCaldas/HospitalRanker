export interface Hospital {
  id: string
  name: string
  city: string
  state: string
  score: number | null
}

export interface CategoryRanking {
  category: string
  label: string
  description: string
  technicalDescription: string
  top5: Hospital[]
  bottom5: Hospital[]
  bestQuip: string
  worstQuip: string
  higherIsBetter: boolean
  measureId: string
  released: string | null
  periodStart: string | null
  periodEnd: string | null
}

export type Category = 'wait_times' | 'mortality' | 'safety' | 'satisfaction' | 'readmission'
