import { useEffect, useState } from 'react'
import axios from 'axios'
import type { HospitalDetail, HospitalMeasure } from '../types'
import { CATEGORIES, formatMonth, formatPercentile, formatValue, shortComparison } from '../lib/format'
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
  if (!hospital) return <p className="text-center text-gray-400 py-16">Pulling the chart…</p>

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
            hospital.emergencyServices === null ? null : hospital.emergencyServices ? 'Emergency services' : 'No emergency services',
            hospital.overallRating !== null ? `CMS overall rating ${hospital.overallRating}★` : null,
            `CMS ID ${hospital.id}`,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {hospital.measures.map(m => <MeasureCard key={m.measureId} m={m} state={hospital.state} />)}
      </div>

      <p className="text-xs text-gray-400">
        Percentiles are oriented so higher always means better, among hospitals CMS scored on that measure.
        Scores describe past performance over each measure's window; they aren't medical advice.
      </p>
    </main>
  )
}

function MeasureCard({ m, state }: { m: HospitalMeasure; state: string | null }) {
  const label = CATEGORIES.find(c => c.id === m.category)?.label ?? m.name
  const comparison = shortComparison(m.comparedToNational)

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-800">{label}</h3>
          <p className="text-xs text-gray-500">
            {m.name}
            {m.windowStart && m.windowEnd && <> · {formatMonth(m.windowStart)} – {formatMonth(m.windowEnd)}</>}
          </p>
        </div>
        <a href={href('rankings', m.category)} className="text-xs text-blue-600 hover:underline whitespace-nowrap">Rankings →</a>
      </div>

      {m.score === null ? (
        <p className="mt-4 text-sm text-gray-500">
          Not reported for this period{m.footnote ? ` (CMS footnote ${m.footnote})` : ''}.
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-baseline gap-3 flex-wrap">
            <span className="text-3xl font-semibold text-gray-900">{formatValue(m.score, m.unit)}</span>
            {m.lowerEstimate !== null && m.higherEstimate !== null && (
              <span className="text-sm text-gray-500">
                95% interval {formatValue(m.lowerEstimate, m.unit)}–{formatValue(m.higherEstimate, m.unit)}
              </span>
            )}
            {comparison && (
              <span className={`px-1.5 py-0.5 rounded border text-xs ${TONE[comparison.tone]}`}>{comparison.label}</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {m.higherIsBetter ? 'Higher is better' : 'Lower is better'}
            {m.cases !== null && <> · {m.cases.toLocaleString('en-US')} cases</>}
            {' · '}median {formatValue(m.stateMedian, m.unit)} in {state}, {formatValue(m.nationalMedian, m.unit)} nationally
          </p>

          <div className="mt-4 space-y-2">
            <PercentileBar label={`Within ${state}`} value={m.statePercentile} note={m.stateHospitals ? `· ${m.stateHospitals} hospitals` : undefined} />
            <PercentileBar label="Nationally" value={m.nationalPercentile} />
          </div>
        </>
      )}
    </section>
  )
}

// Meter: the fill and its unfilled track are two steps of the same blue ramp.
function PercentileBar({ label, value, note }: { label: string; value: number | null; note?: string }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-24 text-gray-500 shrink-0">{label}</span>
      <div
        className="flex-1 h-2 rounded-full overflow-hidden"
        style={{ backgroundColor: '#cde2fb' }}
        role="meter"
        aria-label={`${label} percentile`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value === null ? undefined : Math.round(value * 100)}
      >
        {value !== null && <div className="h-full rounded-full" style={{ width: `${Math.max(2, value * 100)}%`, backgroundColor: '#2a78d6' }} />}
      </div>
      <span className="w-36 text-gray-700 tabular-nums">
        {formatPercentile(value)}{note ? <span className="text-gray-400"> {note}</span> : null}
      </span>
    </div>
  )
}
