import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import type { FinanceMetric, FinanceOverview } from '../types'
import { FINANCE_LABELS, formatFinance } from '../lib/finance'
import { formatMonth } from '../lib/format'
import { formatScore } from '../lib/performance'
import { href } from '../lib/router'
import HowToRead from '../components/HowToRead'

const SERIES = '#2a78d6'
const SURFACE = '#ffffff'

const fmt = (m: FinanceMetric, v: number | null) => formatFinance(v, FINANCE_LABELS[m].format)
const pct = (v: number) => `${Math.round(v * 100)}%`

function strength(rho: number | null): string {
  const a = Math.abs(rho ?? 0)
  if (a < 0.1) return 'essentially no'
  if (a < 0.3) return 'a weak'
  if (a < 0.5) return 'a moderate'
  return 'a strong'
}

export default function FinancesView() {
  const [data, setData] = useState<FinanceOverview | null>(null)
  const [error, setError] = useState(false)
  const [metric, setMetric] = useState<FinanceMetric>('totalMargin')

  useEffect(() => {
    axios.get<FinanceOverview>('/api/finances').then(res => setData(res.data)).catch(() => setError(true))
  }, [])

  if (error) return <p className="text-center text-red-500 py-16">Couldn't load hospital finances.</p>
  if (!data) return <p className="text-center text-gray-400 py-16">Loading…</p>

  const strongest = [...data.vsPerformance].sort((a, b) => Math.abs(b.spearman ?? 0) - Math.abs(a.spearman ?? 0))
  const margins = data.vsPerformance.filter(m => m.metric === 'patientMargin' || m.metric === 'totalMargin')
  const current = data.vsPerformance.find(m => m.metric === metric)!

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-10">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">Follow the money</h2>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed max-w-3xl">
          Hospital finances from the cost reports every hospital files with Medicare, for {data.hospitals.toLocaleString('en-US')}{' '}
          hospitals (fiscal years ending {formatMonth(data.firstYearEnd)} to {formatMonth(data.lastYearEnd)}). The{' '}
          <a href={href('performance')} className="text-blue-600 hover:underline">expected scores</a> deliberately{' '}
          <em>don't</em> adjust for money: a hospital's finances and staffing are partly management's choices, so adjusting
          for them would grade an understaffed hospital on a curve. Instead, this page asks whether money goes along with
          beating expectations.
        </p>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat value={pct(data.losingOnPatients)} label="lose money on patient care" />
        <Stat value={pct(data.losingOverall)} label="lose money overall" />
        <Stat value={formatFinance(data.patientMargin, 'pct')} label="typical margin on patient care" />
        <Stat value={formatFinance(data.totalMargin, 'pct')} label="typical overall margin, after other income" />
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-800">Who pays the bills</h3>
        <p className="text-sm text-gray-600 max-w-3xl">
          Most hospitals lose money treating patients and make it up with other income: donations, grants, government
          support and investments. How much they rely on it depends on who owns them.
        </p>
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Owner</th>
                <th className="px-4 py-2 text-right">Hospitals</th>
                <th className="px-4 py-2 text-right" title={FINANCE_LABELS.patientMargin.help}>Patient-care margin</th>
                <th className="px-4 py-2 text-right" title={FINANCE_LABELS.otherIncomeShare.help}>Other income</th>
                <th className="px-4 py-2 text-right" title={FINANCE_LABELS.totalMargin.help}>Overall margin</th>
                <th className="px-4 py-2 text-right" title={FINANCE_LABELS.uncompensatedShare.help}>Uncompensated care</th>
                <th className="px-4 py-2 text-right">Losing money</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 tabular-nums">
              {data.byOwnership.map(o => (
                <tr key={o.ownership}>
                  <td className="px-4 py-2 text-gray-800">{o.ownership}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{o.hospitals.toLocaleString('en-US')}</td>
                  <td className="px-4 py-2 text-right">{fmt('patientMargin', o.patientMargin)}</td>
                  <td className="px-4 py-2 text-right">{fmt('otherIncomeShare', o.otherIncomeShare)}</td>
                  <td className="px-4 py-2 text-right">{fmt('totalMargin', o.totalMargin)}</td>
                  <td className="px-4 py-2 text-right">{fmt('uncompensatedShare', o.uncompensatedShare)}</td>
                  <td className="px-4 py-2 text-right">{pct(o.losingOverall)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400">Medians within each group. Other income is shown relative to patient revenue.</p>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Does money go with beating expectations?</h3>
          <div className="text-sm text-gray-700 mt-2 bg-white border border-gray-200 rounded-lg p-4 space-y-2 leading-relaxed max-w-3xl">
            <p>
              <strong>Barely, for profits.</strong> Hospitals' margins show {strength(margins[0]?.spearman ?? null)}{' '}
              relationship with how far they beat their expected scores (rank correlation{' '}
              {margins.map(m => (m.spearman ?? 0).toFixed(2)).join(' and ')}).
            </p>
            <p>
              <strong>The strongest links:</strong>{' '}
              {strongest.slice(0, 2).map((m, i) => (
                <span key={m.metric}>
                  {i > 0 && '; '}hospitals with more {FINANCE_LABELS[m.metric].label.toLowerCase()} tend to{' '}
                  {(m.spearman ?? 0) < 0 ? 'fall short of' : 'beat'} expectations ({(m.spearman ?? 0).toFixed(2)})
                </span>
              ))}
              . These are associations, not causes: a struggling hospital may hire agency staff <em>because</em> it's
              struggling.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Finance measure">
          {data.vsPerformance.map(m => (
            <button
              key={m.metric}
              type="button"
              onClick={() => setMetric(m.metric)}
              aria-pressed={metric === m.metric}
              className={`px-3 py-1.5 rounded-md text-sm ${metric === m.metric ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'}`}
            >
              {FINANCE_LABELS[m.metric].label}
            </button>
          ))}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-700">
            <strong>{FINANCE_LABELS[metric].label}:</strong> {FINANCE_LABELS[metric].help}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Hospitals split into five equal groups from lowest to highest; each dot is the group's average overall
            score (0 = exactly as expected), with its 95% range. Rank correlation {(current.spearman ?? 0).toFixed(2)}.
          </p>
          <FifthsChart metric={metric} fifths={current.fifths} />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-blue-600 text-xs">Show as a table</summary>
            <table className="w-full mt-2 tabular-nums">
              <thead className="text-gray-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="py-1 text-left">Group</th>
                  <th className="py-1 text-left">Range</th>
                  <th className="py-1 text-right">Hospitals</th>
                  <th className="py-1 text-right">Average overall score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {current.fifths.map(f => (
                  <tr key={f.fifth}>
                    <td className="py-1">{FIFTH_NAMES[f.fifth - 1]}</td>
                    <td className="py-1">{fmt(metric, f.lo)} to {fmt(metric, f.hi)}</td>
                    <td className="py-1 text-right">{f.hospitals.toLocaleString('en-US')}</td>
                    <td className="py-1 text-right">{formatScore(f.avgScore)} ±{(1.96 * f.se).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      </section>

      <HowToRead
        items={[
          {
            term: 'Where the numbers come from',
            text: "Each hospital's latest Medicare cost report (CMS Hospital Provider Cost Report). Cost reports follow Medicare's accounting rules, which differ from audited financial statements, so treat single-hospital figures as approximate.",
          },
          {
            term: 'Margin on patient care vs. overall margin',
            text: "The first counts only patient revenue against operating costs. The second adds other income such as donations, grants, government appropriations and investment returns. The gap between them shows how much a hospital depends on money from outside patient care.",
          },
          {
            term: 'Why not adjust expected scores for money?',
            text: 'Expected scores adjust for things a hospital can\'t control: its patients, its community and the kind of care it provides. Money and staffing are partly management decisions, and better care can itself bring in money, so adjusting for them would excuse the very differences the ranking is meant to show.',
          },
        ]}
      />
    </main>
  )
}

const FIFTH_NAMES = ['Lowest fifth', 'Second', 'Middle', 'Fourth', 'Highest fifth']

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-2xl font-semibold text-gray-900 tabular-nums">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

// Dot-and-whisker chart: one dot per fifth of the metric, at its group's
// average overall score, with a 95% range. Drawn at measured pixel width.
function FifthsChart({ metric, fifths }: { metric: FinanceMetric; fifths: FinanceOverview['vsPerformance'][number]['fifths'] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(600)
  const [active, setActive] = useState<number | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  const H = 220
  const M = { top: 16, right: 16, bottom: 44, left: 52 }
  const ext = Math.max(0.15, ...fifths.flatMap(f => [Math.abs(f.avgScore - 1.96 * f.se), Math.abs(f.avgScore + 1.96 * f.se)]))
  const y0 = -ext * 1.1
  const y1 = ext * 1.1
  const sx = (i: number) => M.left + ((i + 0.5) / fifths.length) * (W - M.left - M.right)
  const sy = (v: number) => H - M.bottom - ((v - y0) / (y1 - y0)) * (H - M.top - M.bottom)
  const ticks = [-ext, -ext / 2, 0, ext / 2, ext].map(t => Number(t.toFixed(2)))
  const shown = active === null ? null : fifths[active]

  return (
    <div ref={ref} className="relative mt-3">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img"
        aria-label={`Average overall score by fifth of ${FINANCE_LABELS[metric].label}: ${fifths.map(f => formatScore(f.avgScore)).join(', ')}`}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke={t === 0 ? '#9ca3af' : '#f0f1f3'} />
            <text x={M.left - 8} y={sy(t) + 4} fontSize="11" fill="#6b7280" textAnchor="end">{formatScore(t)}</text>
          </g>
        ))}
        <text x={M.left + 4} y={sy(0) - 6} fontSize="11" fill="#6b7280">as expected</text>
        {fifths.map((f, i) => (
          <g key={f.fifth}>
            <line x1={sx(i)} x2={sx(i)} y1={sy(f.avgScore - 1.96 * f.se)} y2={sy(f.avgScore + 1.96 * f.se)} stroke={SERIES} strokeWidth={2} />
            <circle cx={sx(i)} cy={sy(f.avgScore)} r={5} fill={SERIES} stroke={SURFACE} strokeWidth={2} />
            <text x={sx(i)} y={H - M.bottom + 16} fontSize="11" fill="#374151" textAnchor="middle">{FIFTH_NAMES[i]}</text>
            <text x={sx(i)} y={H - M.bottom + 30} fontSize="10" fill="#9ca3af" textAnchor="middle">
              {fmt(metric, f.lo)} to {fmt(metric, f.hi)}
            </text>
            <rect
              x={sx(i) - (W - M.left - M.right) / fifths.length / 2} y={M.top} height={H - M.top - M.bottom}
              width={(W - M.left - M.right) / fifths.length} fill="transparent" tabIndex={0}
              aria-label={`${FIFTH_NAMES[i]}: ${formatScore(f.avgScore)}`}
              onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)} onBlur={() => setActive(null)}
            />
          </g>
        ))}
      </svg>
      {shown && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-gray-200 bg-white px-2 py-1 text-xs shadow-sm whitespace-nowrap"
          style={{ left: Math.min(Math.max(sx(active!) - 80, 0), W - 170), top: Math.max(0, sy(shown.avgScore) - 64) }}
        >
          <div className="text-gray-500">{FIFTH_NAMES[active!]}: {fmt(metric, shown.lo)} to {fmt(metric, shown.hi)}</div>
          <div className="text-gray-900">Average score {formatScore(shown.avgScore)} ±{(1.96 * shown.se).toFixed(2)}</div>
          <div className="text-gray-500">{shown.hospitals.toLocaleString('en-US')} hospitals</div>
        </div>
      )}
    </div>
  )
}
