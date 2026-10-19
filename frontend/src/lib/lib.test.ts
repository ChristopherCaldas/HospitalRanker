import { describe, expect, it } from 'vitest'
import { correlationStrength, formatMonth, formatPercentile, formatValue, shortComparison } from './format'
import { DIVERGING_STEPS, divergingColor, sequentialColor, SEQUENTIAL_STEPS, textOn } from './colors'
import { footnoteText } from './footnotes'

describe('formatValue', () => {
  it('formats each unit', () => {
    expect(formatValue(147.6, 'minutes')).toBe('148 min')
    expect(formatValue(11.84, 'percent')).toBe('11.8%')
    expect(formatValue(0.956, 'ratio')).toBe('0.96')
    expect(formatValue(3, 'stars')).toBe('3★')
    expect(formatValue(3.25, 'stars')).toBe('3.25★')
    expect(formatValue(12050.45, 'dollars')).toBe('$12,050')
  })

  it('shows a dash for missing values', () => {
    expect(formatValue(null, 'percent')).toBe('—')
    expect(formatValue(Number.NaN, 'percent')).toBe('—')
  })
})

describe('formatMonth', () => {
  it('never shifts the month across time zones', () => {
    expect(formatMonth('2024-10-01')).toBe('Oct 2024')
    expect(formatMonth('2025-09-30')).toBe('Sep 2025')
  })
})

describe('formatPercentile', () => {
  it('uses the right ordinal suffix', () => {
    expect([0.01, 0.02, 0.03, 0.04, 0.11, 0.12, 0.13, 0.21, 0.98].map(formatPercentile))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '98th'])
    expect(formatPercentile(null)).toBe('—')
  })
})

describe('correlationStrength', () => {
  it('maps |r| to the conventional words, ignoring sign', () => {
    expect(correlationStrength(0.05)).toBe('no real')
    expect(correlationStrength(-0.2)).toBe('weak')
    expect(correlationStrength(0.39)).toBe('moderate')
    expect(correlationStrength(-0.59)).toBe('strong')
    expect(correlationStrength(null)).toBe('unknown')
  })
})

describe('shortComparison', () => {
  it("shortens CMS's comparison strings", () => {
    expect(shortComparison('Better Than the National Value')).toEqual({ label: 'Better than national', tone: 'better' })
    expect(shortComparison('No Different Than the National Value')?.tone).toBe('same')
    expect(shortComparison('Worse Than the National Value')?.tone).toBe('worse')
    expect(shortComparison('Number of Cases Too Small')).toBeNull()
    expect(shortComparison(null)).toBeNull()
  })
})

describe('color scales', () => {
  it('bins the diverging scale symmetrically around the gray midpoint', () => {
    const mid = DIVERGING_STEPS[3]
    expect(divergingColor(0)).toBe(mid)
    expect(divergingColor(0.1)).toBe(mid)
    expect(divergingColor(1)).toBe(DIVERGING_STEPS[6])
    expect(divergingColor(-1)).toBe(DIVERGING_STEPS[0])
    expect(DIVERGING_STEPS.indexOf(divergingColor(0.5)) - 3).toBe(3 - DIVERGING_STEPS.indexOf(divergingColor(-0.5)))
  })

  it('spans the whole sequential ramp', () => {
    expect(sequentialColor(0, 0, 10)).toBe(SEQUENTIAL_STEPS[0])
    expect(sequentialColor(10, 0, 10)).toBe(SEQUENTIAL_STEPS[SEQUENTIAL_STEPS.length - 1])
  })

  it('puts white text only on the dark steps', () => {
    expect(textOn(SEQUENTIAL_STEPS[0])).not.toBe('#ffffff')
    expect(textOn(SEQUENTIAL_STEPS[6])).toBe('#ffffff')
  })
})

describe('footnoteText', () => {
  it("returns CMS's wording for each code, including multi-code values", () => {
    expect(footnoteText('1, 29')).toEqual([
      'The number of cases/patients is too few to report.',
      'This measure was calculated using partial performance period data due to a CMS-approved exception.',
    ])
    expect(footnoteText('99')).toEqual(['CMS footnote 99.'])
    expect(footnoteText(null)).toEqual([])
  })
})
