import { useEffect, useState } from 'react'
import axios from 'axios'
import type { HospitalDetail, HospitalMeasure } from '../types'
import { CATEGORIES, COMPARISON_HELP, MEASURE_GUIDE, formatMonth, formatValue, shortComparison } from '../lib/format'
import { footnoteText } from '../lib/footnotes'
import { href } from '../lib/router'

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
      </div>

      <p className="text-sm text-gray-600">
        How this hospital did on each measure, and how that compares with other hospitals in {hospital.state} and
        across the country.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {hospital.measures.map(m => <MeasureCard key={m.measureId} m={m} state={hospital.state} />)}
      </div>

      <p className="text-xs text-gray-400">
        "Better than X%" compares this hospital only with hospitals CMS scored on the same measure. Scores describe care
        delivered during each measure's dates, published a year or more later; they aren't medical advice.
      </p>
    </main>
  )
}

function MeasureCard({ m, state }: { m: HospitalMeasure; state: string | null }) {
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
