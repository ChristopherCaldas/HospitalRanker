import { useEffect, useState } from 'react'
import axios from 'axios'
import type { ValueHospital, ValueOverview } from '../types'
import { formatScore } from '../lib/performance'
import { formatMonth } from '../lib/format'
import { strengthOf } from '../lib/quality'
import { href } from '../lib/router'
import DotChart from './DotChart'

const SERIES = '#2a78d6'
const FIFTHS = ['Lowest fifth', 'Second', 'Middle', 'Fourth', 'Highest fifth']
const usd = (v: number) => `$${Math.round(v / 1000).toLocaleString('en-US')}k`

// Efficiency, one of Donabedian's pillars: what care costs next to the outcome
// score. Two costs: what Medicare pays around a stay (MSPB) and what the
// hospital itself spends per patient.
export default function ValueSection() {
  const [data, setData] = useState<ValueOverview | null>(null)
  const [error, setError] = useState(false)
  const [view, setView] = useState<'mspb' | 'cost'>('mspb')
  useEffect(() => {
    axios.get<ValueOverview>('/api/quality/value').then(res => setData(res.data)).catch(() => setError(true))
  }, [])
  if (error) return <p className="text-sm text-red-500">Couldn't load the value analysis.</p>
  if (!data) return <p className="text-sm text-gray-400">Loading value analysis…</p>

  const q = data.quadrants
  const fifths = view === 'mspb' ? data.mspbFifths : data.costFifths
  const fmt = (v: number) => (view === 'mspb' ? v.toFixed(2) : usd(v))
  const rMspb = data.spearmanMspbOutcome ?? 0
  const rCost = data.spearmanCostOutcome ?? 0
  const rBoth = data.spearmanMspbCost ?? 0

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-800">Value: what care costs, and who pays</h3>
        <p className="text-sm text-gray-600 mt-1 max-w-3xl leading-relaxed">
          Efficiency is one of Donabedian's <a href={href('framework')} className="text-blue-600 hover:underline">pillars of quality</a>:
          the same results for less money. There are two different costs to look at:
        </p>
        <ul className="text-sm text-gray-600 mt-2 max-w-3xl list-disc pl-5 space-y-1">
          <li>
            <strong>What Medicare pays.</strong> Medicare Spending Per Beneficiary adds up everything Medicare paid
            from 3 days before a hospital stay to 30 days after: the stay, doctors, rehab, nursing homes and any
            readmission. It's adjusted for regional prices and for how sick patients are; 1.00 is the national median
            ({formatMonth(data.windowStart)} to {formatMonth(data.windowEnd)}).
          </li>
          <li>
            <strong>What the hospital spends.</strong> Total costs per discharge from the cost report, divided by the
            hospital's case mix index so hospitals treating more complex cases aren't penalized. It includes outpatient
            costs, so treat it as a rough guide.
          </li>
        </ul>
        <p className="text-xs text-gray-500 mt-2 max-w-3xl">
          What patients pay out of pocket and what private insurers pay aren't published in a form that can be compared
          across hospitals, so they aren't shown.
        </p>
      </div>

      <div className="text-sm text-gray-700 bg-white border border-gray-200 rounded-lg p-4 space-y-2 leading-relaxed max-w-3xl">
        <p>
          <strong>Lower Medicare spending goes with {rMspb < 0 ? 'better' : 'worse'} outcomes</strong>, not worse:{' '}
          {strengthOf(rMspb)} relationship (rank correlation {rMspb.toFixed(2)}) between a hospital's Medicare spending
          and its outcome score.
        </p>
        <p>
          <strong>Hospitals that spend more themselves have {rCost > 0 ? 'better' : 'worse'} outcomes</strong>{' '}
          ({rCost.toFixed(2)}), and the two costs move in {rBoth < 0 ? 'opposite directions' : 'the same direction'}{' '}
          ({rBoth.toFixed(2)}).{' '}
          {rBoth < 0 && 'Hospitals that invest more in each stay tend to cost Medicare less overall, plausibly because their patients need less rehab, nursing-home care and readmission afterward.'}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Quadrant n={q.betterCheaper} label="better outcomes, lower Medicare spending" tone="text-green-700" />
        <Quadrant n={q.betterCostlier} label="better outcomes, higher spending" />
        <Quadrant n={q.worseCheaper} label="worse outcomes, lower spending" />
        <Quadrant n={q.worseCostlier} label="worse outcomes, higher spending" tone="text-red-700" />
      </div>
      <p className="text-xs text-gray-500 -mt-2">
        Of {data.hospitals.toLocaleString('en-US')} hospitals with both numbers. Better/worse = outcome score above or
        below 0 (as expected); lower/higher = spending below or above the national median. Medicare spending ranges from{' '}
        {data.p10Mspb.toFixed(2)} to {data.p90Mspb.toFixed(2)} for the middle 80% of hospitals.
      </p>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Cost measure">
          {([['mspb', 'What Medicare pays'], ['cost', 'What the hospital spends']] as const).map(([v, label]) => (
            <button
              key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
              className={`px-3 py-1.5 rounded-md text-sm ${view === v ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Hospitals split into five equal groups from lowest to highest cost; each dot is the group's average outcome
          score (0 = as expected), with its 95% range.
        </p>
        <DotChart
          categories={fifths.map((f, i) => ({ label: FIFTHS[i], sublabel: `${fmt(f.lo)} to ${fmt(f.hi)}` }))}
          series={[{ name: 'Outcome score', color: SERIES, values: fifths.map(f => f.avgOutcome), se: fifths.map(f => f.se) }]}
          format={formatScore}
          zeroLabel="as expected"
          ariaLabel={`Average outcome score by fifth of ${view === 'mspb' ? 'Medicare spending' : 'hospital spending'}`}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <ValueList title="Better outcomes for less Medicare money" note="Clearly better outcomes than expected, Medicare spending at least 5% below the median." rows={data.highValue} />
        <ValueList title="Worse outcomes for more Medicare money" note="Clearly worse outcomes than expected, Medicare spending at least 5% above the median." rows={data.lowValue} />
      </div>
    </section>
  )
}

function Quadrant({ n, label, tone = 'text-gray-900' }: { n: number; label: string; tone?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{n.toLocaleString('en-US')}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

function ValueList({ title, note, rows }: { title: string; note: string; rows: ValueHospital[] }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm">
      <h4 className="font-semibold text-gray-800">{title}</h4>
      <p className="text-xs text-gray-500 mb-2">{note}</p>
      {rows.length === 0 ? (
        <p className="text-gray-400">No hospitals meet both conditions.</p>
      ) : (
        <table className="w-full tabular-nums">
          <thead className="text-gray-500 text-xs">
            <tr>
              <th className="py-1 text-left font-normal">Hospital</th>
              <th className="py-1 text-right font-normal">Outcome</th>
              <th className="py-1 text-right font-normal">Medicare spending</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => (
              <tr key={r.id}>
                <td className="py-1">
                  <a href={href('hospitals', r.id)} className="text-blue-700 hover:underline">{r.name}</a>
                  <span className="text-gray-400 text-xs"> {r.city}, {r.state}</span>
                </td>
                <td className="py-1 text-right">{formatScore(r.outcome)}</td>
                <td className="py-1 text-right">{r.mspb.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
