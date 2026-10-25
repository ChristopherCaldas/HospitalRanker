import { describe, expect, it } from 'vitest'
import { chainTests, clinicalOutcome, type ChainHospital } from '../src/analysis/chain'

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32
    return seed / 2 ** 32
  }
}

describe('clinicalOutcome', () => {
  it('averages the clinical outcome groups a hospital has, if at least two', () => {
    expect(clinicalOutcome({ mortality: 1, safety: 0, readmission: -1, experience: 5 })).toBe(0)
    expect(clinicalOutcome({ mortality: 1, readmission: 0 })).toBe(0.5)
    expect(clinicalOutcome({ mortality: 1, experience: 5 })).toBeNull()
  })
})

describe('chainTests', () => {
  // Staffing drives process; process drives outcomes; staffing has no effect
  // on outcomes except through process. Pay is unrelated to anything.
  const r = rng(3)
  const normal = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())
  const hospitals: ChainHospital[] = Array.from({ length: 2000 }, () => {
    const staff = normal()
    const process = 0.6 * staff + normal()
    const outcome = () => 0.5 * process + normal()
    return {
      structure: { fte_per_bed: 4 + staff, salary_per_fte: 80000 + 10000 * normal() },
      scores: { process, timely_effective: process + normal(), mortality: outcome(), safety: outcome(), readmission: outcome() },
    }
  })
  const tests = chainTests(hospitals)
  const find = (link: string, x: string, y: string) => tests.find(t => t.link === link && t.x === x && t.y === y)!

  it('finds structure -> process and process -> outcome links', () => {
    expect(find('structure_process', 'fte_per_bed', 'process').r!).toBeGreaterThan(0.3)
    expect(find('process_outcome', 'process', 'clinical_outcome').r!).toBeGreaterThan(0.4)
    expect(find('process_outcome', 'process', 'clinical_outcome').qValue!).toBeLessThan(0.001)
  })

  it('shows a structure -> outcome link that runs through process', () => {
    const t = find('structure_outcome', 'fte_per_bed', 'clinical_outcome')
    expect(t.r!).toBeGreaterThan(0.15)
    expect(Math.abs(t.partialR!)).toBeLessThan(0.06)
  })

  it('reports fifths and leaves unrelated variables insignificant', () => {
    const t = find('process_outcome', 'process', 'clinical_outcome')
    expect(t.topFifth!).toBeGreaterThan(t.bottomFifth!)
    expect(find('structure_process', 'salary_per_fte', 'process').qValue!).toBeGreaterThan(0.05)
  })

  it('skips variables with too little data', () => {
    expect(find('structure_process', 'contract_labor', 'process').r).toBeNull()
    expect(find('pair', 'SEP_1', 'mortality').n).toBe(0)
  })
})
