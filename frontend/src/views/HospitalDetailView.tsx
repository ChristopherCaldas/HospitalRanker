import { useEffect, useState } from 'react'
import axios from 'axios'
import type { ContextField, FinanceMetric, HistoryPoint, HospitalContext, HospitalDetail, HospitalFinance, HospitalMeasure, HospitalMover, HospitalPerformance } from '../types'
import { CONTEXT_LABELS, FINANCE_LABELS, formatDollars, formatFinance } from '../lib/finance'
import { NOTE_KINDS, VERDICT_LABELS, formatScore } from '../lib/performance'
import { CATEGORIES, COMPARISON_HELP, MEASURE_GUIDE, formatMonth, formatValue, shortComparison } from '../lib/format'
import { footnoteText } from '../lib/footnotes'
import { MOVER_LABELS } from '../lib/movers'
import { href } from '../lib/router'
import TrendChart, { TrendLegend } from '../components/TrendChart'

const TONE = {
  better: 'bg-green-50 text-green-800 border-green-200',
  same: 'bg-gray-50 text-gray-600 border-gray-200',
  worse: 'bg-red-50 text-red-800 border-red-200',
}

export default function HospitalDetailView({ id }: { id: string }) {
  const [hospital, setHospital] = useState<HospitalDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setHospital(null)
    setError(null)
    axios
      .get<HospitalDetail>(`/api/hospitals/${encodeURIComponent(id)}`)
      .then(res => setHospital(res.data))
      .catch(err => setError(err.response?.status === 404 ? 'No hospital with that CMS ID.' : 'Failed to load this hospital.'))
  }, [id])

  if (error) return <p className="text-center text-red-500 py-16">{error}</p>
  if (!hospital) return <p className="text-center text-gray-400 py-16">Loading hospital…</p>

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <a href={href('hospitals')} className="text-sm text-blue-600 hover:underline">← Search hospitals</a>

      <div>
        <h2 className="text-2xl font-semibold text-gray-900">{hospital.name}</h2>
        <p className="text-sm text-gray-500 mt-1">
          {[hospital.address, hospital.city, hospital.state, hospital.zipCode].filter(Boolean).join(', ')}
        </p>
        <p className="text-sm text-gray-500 mt-1">
          {[
            hospital.hospitalType,
            hospital.ownership,
            hospital.emergencyServices === null ? null : hospital.emergencyServices ? 'Has an emergency department' : 'No emergency department',
            `CMS ID ${hospital.id}`,
          ].filter(Boolean).join(' · ')}
        </p>
        {hospital.overallRating !== null && (
          <p className="text-sm text-gray-700 mt-2" title="CMS's summary rating across dozens of quality measures">
            CMS overall star rating: <strong>{hospital.overallRating} out of 5</strong>
          </p>
        )}
        {hospital.usNewsHonorRoll && (
          <p className="text-sm text-gray-700 mt-1">On the U.S. News Best Hospitals Honor Roll (2026–27).</p>
        )}
      </div>

      {hospital.performance.overall && (
        <section className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold text-gray-800">Compared with what its context predicts</h3>
            <a href={href('performance')} className="text-xs text-blue-600 hover:underline">How this works →</a>
          </div>
          <p className="text-sm text-gray-700 mt-2">
            Ranked <strong>#{hospital.performance.overall.nationalRank.toLocaleString('en-US')}</strong> of{' '}
            {hospital.performance.overall.nationalCount.toLocaleString('en-US')} nationally and{' '}
            <strong>#{hospital.performance.overall.stateRank}</strong> of {hospital.performance.overall.stateCount} in{' '}
            {hospital.state}, after accounting for its type, patients, community and state across{' '}
            {hospital.performance.overall.measures} measures.
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Overall score {formatScore(hospital.performance.overall.score)} (±
            {(1.96 * hospital.performance.overall.scoreSe).toFixed(2)}), where 0 is exactly as expected.{' '}
            <span className={`inline-block px-1.5 py-0.5 rounded border text-xs ${VERDICT_LABELS[hospital.performance.overall.verdict].className}`}>
              {VERDICT_LABELS[hospital.performance.overall.verdict].label}
            </span>
          </p>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ContextCard context={hospital.context} hospitalType={hospital.hospitalType} />
        <FinanceCard finance={hospital.finance} hospitalType={hospital.hospitalType} />
      </div>

      {hospital.notes.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="font-semibold text-gray-800">In the news</h3>
          <ul className="mt-2 space-y-2 text-sm text-gray-700">
            {hospital.notes.map(n => (
              <li key={n.url}>
                <span className="text-xs text-gray-500">{NOTE_KINDS[n.kind]} · </span>
                {n.summary}{' '}
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline whitespace-nowrap">
                  {n.source}, {formatMonth(n.published)} ↗
                </a>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-400 mt-2">
            Summarized in our own words from the linked sources. Items marked as a hospital press release are the
            hospital's own claims.
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-gray-600">
          How this hospital did on each measure, how that compares with other hospitals in {hospital.state} and across
          the country, and how it has changed since 2018.
        </p>
        <TrendLegend />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {hospital.measures.map(m => (
          <MeasureCard
            key={m.measureId}
            m={m}
            state={hospital.state}
            perf={hospital.performance.measures.find(p => p.category === m.category) ?? null}
            history={hospital.history[m.category] ?? []}
            mover={hospital.movers?.[m.category] ?? null}
          />
        ))}
      </div>

      <p className="text-xs text-gray-400">
        "Better than X%" compares this hospital only with hospitals CMS scored on the same measure. Scores describe care
        delivered during each measure's dates, published a year or more later; they aren't medical advice.
      </p>
    </main>
  )
}

function MeasureCard({ m, state, perf, history, mover }: {
  m: HospitalMeasure
  state: string | null
  perf: HospitalPerformance['measures'][number] | null
  history: HistoryPoint[]
  mover: HospitalMover | null
}) {
  const label = CATEGORIES.find(c => c.id === m.category)?.label ?? m.name
  const guide = MEASURE_GUIDE[m.category]
  const comparison = shortComparison(m.comparedToNational)
  const notes = footnoteText(m.footnote)

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-800">{label}</h3>
          {m.windowStart && m.windowEnd && (
            <p className="text-xs text-gray-500">Care delivered {formatMonth(m.windowStart)} – {formatMonth(m.windowEnd)}</p>
          )}
        </div>
        <a href={href('rankings', m.category)} className="text-xs text-blue-600 hover:underline whitespace-nowrap">See rankings →</a>
      </div>
      {guide && <p className="text-xs text-gray-500 mt-2 leading-relaxed">{guide.score}</p>}

      {m.score === null ? (
        <div className="mt-4 text-sm text-gray-500">
          <p>No score for this period.</p>
          {notes.map(n => <p key={n} className="text-xs text-gray-400 mt-1">CMS: “{n}”</p>)}
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-baseline gap-3 flex-wrap">
            <span className="text-3xl font-semibold text-gray-900">{formatValue(m.score, m.unit)}</span>
            <span className="text-sm text-gray-500">{m.higherIsBetter ? 'higher is better' : 'lower is better'}</span>
            {comparison && (
              <span title={COMPARISON_HELP} className={`px-1.5 py-0.5 rounded border text-xs ${TONE[comparison.tone]}`}>
                {comparison.label}
              </span>
            )}
          </div>
          <ul className="text-xs text-gray-500 mt-2 space-y-0.5">
            {m.lowerEstimate !== null && m.higherEstimate !== null && (
              <li title="CMS's 95% interval: the true score very likely falls in this range">
                Margin of error: {formatValue(m.lowerEstimate, m.unit)} to {formatValue(m.higherEstimate, m.unit)}
              </li>
            )}
            {m.cases !== null && guide?.caseNoun && <li>Based on {m.cases.toLocaleString('en-US')} {guide.caseNoun}</li>}
            <li>
              Typical hospital: {formatValue(m.stateMedian, m.unit)} in {state}, {formatValue(m.nationalMedian, m.unit)} nationwide
            </li>
            {notes.map(n => <li key={n} className="text-gray-400">CMS note: “{n}”</li>)}
          </ul>

          {perf && (
            <div className="mt-3 text-xs text-gray-600 border-t border-gray-100 pt-2">
              Expected for a hospital like this: <strong>{formatValue(perf.expected, m.unit)}</strong>.{' '}
              <span className={`inline-block px-1.5 py-0.5 rounded border ${VERDICT_LABELS[perf.verdict].className}`}>
                {VERDICT_LABELS[perf.verdict].label}
              </span>
            </div>
          )}

          <div className="mt-4 space-y-2">
            <PercentileBar
              label={`In ${state}`}
              value={m.statePercentile}
              of={m.stateHospitals ? `of ${m.stateHospitals} ${state} hospitals` : `of ${state} hospitals`}
            />
            <PercentileBar label="Nationwide" value={m.nationalPercentile} of="of hospitals nationwide" />
          </div>
        </>
      )}

      {history.length > 1 && (
        <div className="mt-4 pt-3 border-t border-gray-100">
          <TrendChart label="Trend" points={history} unit={m.unit} higherIsBetter={m.higherIsBetter} />
          {mover && (
            <p className="text-xs text-gray-600 mt-2">
              {formatMonth(mover.from)} to {formatMonth(mover.to)}:{' '}
              {mover.verdict === 'steady' ? (
                <span className="text-gray-500">no clear change once luck and regression to the mean are allowed for</span>
              ) : (
                <span className={`inline-block px-1.5 py-0.5 rounded border ${MOVER_LABELS[mover.verdict].className}`}>
                  {MOVER_LABELS[mover.verdict].label}
                </span>
              )}{' '}
              <a href={href('movers', m.category)} className="text-blue-600 hover:underline">Movers →</a>
            </p>
          )}
        </div>
      )}
    </section>
  )
}

// Meter: the fill and its unfilled track are two steps of the same blue ramp.
// `value` is the share of other scored hospitals this one did better than.
function PercentileBar({ label, value, of }: { label: string; value: number | null; of: string }) {
  const pct = value === null ? null : Math.round(value * 100)
  return (
    <div className="text-xs">
      <div className="flex justify-between gap-2 mb-1">
        <span className="text-gray-500">{label}</span>
        <span className="text-gray-700">
          {pct === null ? '—' : pct === 100 ? `Top score ${of.replace(/^of /, 'among ')}` : `Better than ${pct}% ${of}`}
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ backgroundColor: '#cde2fb' }}
        role="meter"
        aria-label={`${label}: better than ${pct ?? 'unknown'}% ${of}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
      >
        {pct !== null && <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, backgroundColor: '#2a78d6' }} />}
      </div>
    </div>
  )
}

// What the expected scores adjust for, at the hospital level.
function ContextCard({ context, hospitalType }: { context: HospitalContext | null; hospitalType: string | null }) {
  const fields = Object.keys(CONTEXT_LABELS) as ContextField[]
  const shown = context ? fields.filter(f => context.values[f] !== null) : []
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="font-semibold text-gray-800">What its expected scores account for</h3>
      <p className="text-xs text-gray-500 mt-1">
        Besides its type ({hospitalType ?? 'unknown'}) and ownership: its patients, its county and, for ER times and
        patient ratings, how complex its care is.
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-gray-500 mt-3">No hospital-level context on file; only type, ownership and state are used.</p>
      ) : (
        <table className="w-full text-sm mt-3">
          <thead className="text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="py-1 text-left font-medium">Factor</th>
              <th className="py-1 text-right font-medium">This hospital</th>
              <th className="py-1 text-right font-medium">Typical</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 tabular-nums">
            {shown.map(f => (
              <tr key={f} title={CONTEXT_LABELS[f].help}>
                <td className="py-1.5 text-gray-700">{CONTEXT_LABELS[f].label}</td>
                <td className="py-1.5 text-right text-gray-900">{formatFinance(context!.values[f], CONTEXT_LABELS[f].format)}</td>
                <td className="py-1.5 text-right text-gray-500">{formatFinance(context!.nationalMedians[f], CONTEXT_LABELS[f].format)}</td>
              </tr>
            ))}
            {context!.values.rural !== null && (
              <tr>
                <td className="py-1.5 text-gray-700">Rural</td>
                <td className="py-1.5 text-right text-gray-900">{context!.values.rural ? 'Yes' : 'No'}</td>
                <td className="py-1.5" />
              </tr>
            )}
          </tbody>
        </table>
      )}
      {context && shown.length < fields.length && (
        <p className="text-xs text-gray-400 mt-2">
          Some factors come from CMS payment files that cover only regular acute care hospitals; missing ones are treated as average.
        </p>
      )}
    </section>
  )
}

// Cost-report finances: shown for context, not used in expected scores.
function FinanceCard({ finance, hospitalType }: { finance: HospitalFinance | null; hospitalType: string | null }) {
  const metrics = Object.keys(FINANCE_LABELS) as FinanceMetric[]
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-gray-800">Finances</h3>
        <a href={href('finances')} className="text-xs text-blue-600 hover:underline">Does money matter? →</a>
      </div>
      {!finance ? (
        <p className="text-sm text-gray-500 mt-3">No Medicare cost report on file for this hospital.</p>
      ) : (
        <>
          <p className="text-xs text-gray-500 mt-1">
            Fiscal year ending {formatMonth(finance.fiscalYearEnd)} · {finance.beds ?? '—'} beds ·{' '}
            {formatDollars(finance.netPatientRevenue)} patient revenue, {formatDollars(finance.otherIncome)} other income.
            Shown for context only; expected scores don't adjust for money.
          </p>
          <table className="w-full text-sm mt-3">
            <thead className="text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="py-1 text-left font-medium">Measure</th>
                <th className="py-1 text-right font-medium">This hospital</th>
                <th className="py-1 text-right font-medium" title={`Median for ${hospitalType ?? 'hospitals of this type'}`}>Same type</th>
                <th className="py-1 text-right font-medium">All</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 tabular-nums">
              {metrics.map(m => (
                <tr key={m} title={FINANCE_LABELS[m].help}>
                  <td className="py-1.5 text-gray-700">{FINANCE_LABELS[m].label}</td>
                  <td className="py-1.5 text-right text-gray-900">{formatFinance(finance.values[m], FINANCE_LABELS[m].format)}</td>
                  <td className="py-1.5 text-right text-gray-500">{formatFinance(finance.typeMedians[m], FINANCE_LABELS[m].format)}</td>
                  <td className="py-1.5 text-right text-gray-500">{formatFinance(finance.nationalMedians[m], FINANCE_LABELS[m].format)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-400 mt-2">
            From the hospital's Medicare cost report, which follows Medicare accounting rules rather than audited
            financial statements. Hover a row for what it means.
          </p>
        </>
      )}
    </section>
  )
}
