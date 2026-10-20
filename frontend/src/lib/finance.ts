import type { ContextField, FinanceMetric } from '../types'
import { formatPercentile } from './format'

// Plain-language labels for cost-report finance metrics and the hospital-level
// context the expected scores adjust for (backend/src/services/finances.ts).

export const FINANCE_LABELS: Record<FinanceMetric, { label: string; help: string; format: 'pct' | 'ratio' }> = {
  patientMargin: {
    label: 'Margin on patient care',
    help: 'What is left from patient revenue after operating costs. Negative means patient care alone loses money, which is common.',
    format: 'pct',
  },
  totalMargin: {
    label: 'Overall margin',
    help: 'Margin after other income (donations, grants, government support, investments) and other expenses.',
    format: 'pct',
  },
  otherIncomeShare: {
    label: 'Other income',
    help: 'Income from outside patient care, such as donations, grants, government appropriations and investment returns, as a share of patient revenue.',
    format: 'pct',
  },
  uncompensatedShare: {
    label: 'Uncompensated care',
    help: 'The cost of charity care and unpaid bills, as a share of total costs.',
    format: 'pct',
  },
  medicaidDayShare: {
    label: 'Medicaid patient days',
    help: 'Share of inpatient days paid by Medicaid, which usually pays less than cost.',
    format: 'pct',
  },
  contractLaborShare: {
    label: 'Contract staff',
    help: 'Spending on contract (agency or traveling) clinical staff, relative to payroll.',
    format: 'pct',
  },
  ftePerBed: {
    label: 'Staff per bed',
    help: 'Full-time-equivalent employees per bed.',
    format: 'ratio',
  },
  occupancy: {
    label: 'Beds in use',
    help: 'Share of available bed-days that were filled.',
    format: 'pct',
  },
}

export const CONTEXT_LABELS: Record<ContextField, { label: string; help: string; format: 'pct01' | 'pct100' | 'ratio' | 'percentile' }> = {
  dualProportion: {
    label: 'Patients on Medicare and Medicaid',
    help: "Share of the hospital's Medicare stays where the patient also had full Medicaid, a marker of low income.",
    format: 'pct01',
  },
  dshPct: {
    label: 'Low-income patients (DSH)',
    help: "CMS's disproportionate-share percentage: Medicaid and low-income Medicare patient days.",
    format: 'pct01',
  },
  caseMixIndex: {
    label: 'Case mix',
    help: 'How complex and resource-intensive its Medicare inpatients are; 1.0 is average for Medicare.',
    format: 'ratio',
  },
  residentBedRatio: {
    label: 'Residents per bed',
    help: 'Doctors in training per bed: how much of a teaching hospital it is.',
    format: 'ratio',
  },
  sviPercentile: {
    label: 'County social vulnerability',
    help: "CDC's Social Vulnerability Index for the hospital's county, as a national percentile (higher = more vulnerable).",
    format: 'percentile',
  },
  poverty150Pct: {
    label: 'County residents near poverty',
    help: 'Share of county residents below 150% of the federal poverty line.',
    format: 'pct100',
  },
  uninsuredPct: {
    label: 'County uninsured',
    help: 'Share of county residents without health insurance.',
    format: 'pct100',
  },
}

export function formatFinance(value: number | null | undefined, format: 'pct' | 'ratio' | 'pct01' | 'pct100' | 'percentile'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  switch (format) {
    case 'pct':
    case 'pct01':
      return `${(value * 100).toFixed(1)}%`
    case 'pct100':
      return `${value.toFixed(1)}%`
    case 'percentile':
      return formatPercentile(value)
    default:
      return value.toFixed(2)
  }
}

export function formatDollars(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(0)}M`
  return `$${Math.round(value).toLocaleString('en-US')}`
}
