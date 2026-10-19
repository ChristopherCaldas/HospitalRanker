import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import type { Category, Correlation, Factor, StateAnalysis, StateRow } from '../types'
import { CATEGORIES, FACTORS, formatMonth, formatValue } from '../lib/format'
import { DIVERGING_STEPS, SEQUENTIAL_STEPS, divergingColor, sequentialColor } from '../lib/colors'
import { href } from '../lib/router'
import TabNav from '../components/TabNav'
import TileMap from '../components/TileMap'
import Scatter from '../components/Scatter'

const FDR = 0.05
// Lowercase for mid-sentence use, leaving acronyms like 'ER' intact.
const midSentence = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1)).replace(/ ([A-Z])([a-z])/g, (_, a, b) => ' ' + a.toLowerCase() + b).replace(/-([A-Z])/g, (_, a) => '-' + a.toLowerCase())
const fmtR = (r: number | null) => (r === null ? '—' : (r >= 0 ? '+' : '−') + Math.abs(r).toFixed(2))

// "States with higher ICU occupancy tend to have worse ER wait times."
function finding(c: Correlation, factorNoun: string, outcomeLabel: string, higherIsBetter: boolean): string {
  if (c.partialR === null || c.partialQ === null || c.partialQ >= FDR) {
    return `No reliable association between ${factorNoun} and ${midSentence(outcomeLabel)} once multiple comparisons are accounted for.`
  }
  const better = (c.partialR > 0) === higherIsBetter
  return `States with higher ${factorNoun} tend to have ${better ? 'better' : 'worse'} ${midSentence(outcomeLabel)}.`
}

export default function StatesView({ category }: { category: Category }) {
  const [data, setData] = useState<StateAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [factor, setFactor] = useState<Factor>('inpatient_occupancy')
  const [colorBy, setColorBy] = useState<'outcome' | 'factor'>('outcome')
  const [highlight, setHighlight] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    axios
      .get<StateAnalysis>(`/api/analysis/${category}`)
      .then(res => setData(res.data))
      .catch(() => setError('Failed to load the state analysis.'))
      .finally(() => setLoading(false))
  }, [category])

  const f = FACTORS.find(x => x.id === factor)!
  const byState = useMemo(() => new Map((data?.states ?? []).map(s => [s.state, s])), [data])
  const corr = data?.correlations.find(c => c.factor === factor) ?? null
  const value = (s: StateRow) => s[f.key] as number | null

  const tiles = useMemo(() => {
    if (!data) return []
    if (colorBy === 'outcome') {
      const maxDev = Math.max(...data.states.map(s => Math.abs(s.outcome - data.nationalOutcome))) || 1
      return data.states.map(s => {
        const dev = (s.outcome - data.nationalOutcome) / maxDev
        return { state: s.state, fill: divergingColor(data.higherIsBetter ? dev : -dev) }
      })
    }
    const vals = data.states.map(value).filter((v): v is number => v !== null)
    const [lo, hi] = [Math.min(...vals), Math.max(...vals)]
    return data.states.map(s => {
      const v = value(s)
      return { state: s.state, fill: v === null ? null : sequentialColor(v, lo, hi) }
    })
  }, [data, colorBy, f.key])

  const tooltip = (state: string) => {
    const s = byState.get(state)
    if (!s || !data) return <span>{state}: no data</span>
    return (
      <div className="space-y-1">
        <div className="font-semibold text-gray-900">{state}</div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-500">{data.label}</span>
          <strong className="text-gray-900">{formatValue(s.outcome, data.unit)}</strong>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-gray-500">{f.short}</span>
          <strong className="text-gray-900">{formatValue(value(s), f.unit)}</strong>
        </div>
        <div className="text-gray-400">
          {s.hospitals} hospitals{s.cases ? ` · ${Math.round(s.cases).toLocaleString('en-US')} cases` : ''}
        </div>
      </div>
    )
  }

  const outcomeLabel = data?.label ?? ''
  const direction = data ? (data.higherIsBetter ? 'higher is better' : 'lower is better') : ''

  return (
    <>
      <TabNav categories={CATEGORIES} active={category} hrefFor={c => href('states', c)} />

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {error && <p className="text-center text-red-500 py-16">{error}</p>}
        {!data && loading && <p className="text-center text-gray-400 py-16">Crunching 50 states and DC…</p>}

        {data && !error && (
          <div className={`space-y-6 ${loading ? 'opacity-60' : ''} transition-opacity`}>
            <div>
              <h2 className="text-xl font-semibold text-gray-800">{data.label}: how states compare</h2>
              <p className="text-sm text-gray-500 mt-1">
                Each state's case-weighted average for {data.measureId} ({direction}), set against hospital strain and
                Medicare spending averaged over the same period the scores cover:{' '}
                {formatMonth(data.windowStart)} – {formatMonth(data.windowEnd)}. 50 states + DC.
              </p>
            </div>

            {/* Filters: one row above everything they scope. */}
            <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Compare with">
              <span className="text-gray-600 mr-1">Compare with</span>
              {FACTORS.map(x => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setFactor(x.id)}
                  aria-pressed={factor === x.id}
                  className={`px-3 py-1 rounded-full border ${
                    factor === x.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  {x.short}
                </button>
              ))}
            </div>

            {corr && (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <p className="text-gray-800 font-medium">{finding(corr, f.noun, outcomeLabel, data.higherIsBetter)}</p>
                <p className="text-sm text-gray-500 mt-1">
                  Partial r = {fmtR(corr.partialR)} (95% CI {fmtR(corr.partialCiLow)} to {fmtR(corr.partialCiHigh)}),
                  controlling for each state's dual-eligible share · FDR q = {corr.partialQ?.toFixed(3) ?? '—'} · n = {corr.n}.
                  An association across states, not a causal effect.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">
                    {colorBy === 'outcome' ? `${outcomeLabel} vs national` : f.label}
                  </h3>
                  <div className="flex text-xs border border-gray-300 rounded-md overflow-hidden" role="group" aria-label="Color map by">
                    {(['outcome', 'factor'] as const).map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColorBy(c)}
                        aria-pressed={colorBy === c}
                        className={`px-2 py-1 ${colorBy === c ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
                      >
                        {c === 'outcome' ? 'Outcome' : f.short}
                      </button>
                    ))}
                  </div>
                </div>
                <TileMap
                  tiles={tiles}
                  highlight={highlight}
                  onHighlight={setHighlight}
                  tooltip={tooltip}
                  label={`Tile map of states colored by ${colorBy === 'outcome' ? outcomeLabel : f.label}`}
                  legend={
                    colorBy === 'outcome' ? (
                      <Legend steps={DIVERGING_STEPS} left="Worse than national" right="Better" />
                    ) : (
                      <Legend steps={SEQUENTIAL_STEPS} left="Lower" right="Higher" />
                    )
                  }
                />
              </section>

              <section className="bg-white border border-gray-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">One dot per state</h3>
                <Scatter
                  points={data.states
                    .filter(s => s.hospitals >= 3 && value(s) !== null)
                    .map(s => ({ id: s.state, x: value(s)!, y: s.outcome }))}
                  fit={corr ? { slope: corr.slope, intercept: corr.intercept } : null}
                  xLabel={f.label}
                  yLabel={`${outcomeLabel} (${direction})`}
                  formatX={v => formatValue(v, f.unit)}
                  formatY={v => formatValue(v, data.unit)}
                  highlight={highlight}
                  onHighlight={setHighlight}
                  tooltip={tooltip}
                  label={`Scatter plot of ${outcomeLabel} against ${f.label} by state`}
                />
              </section>
            </div>

            <section className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
              <h3 className="text-sm font-semibold text-gray-700 px-4 pt-4">All factors for {midSentence(outcomeLabel)}</h3>
              <table className="w-full text-sm mt-2">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-2 text-left">Factor</th>
                    <th className="px-4 py-2 text-right">r</th>
                    <th className="px-4 py-2 text-right">Partial r (95% CI)</th>
                    <th className="px-4 py-2 text-right">FDR q</th>
                    <th className="px-4 py-2 text-left">Verdict</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 tabular-nums">
                  {FACTORS.map(x => {
                    const c = data.correlations.find(k => k.factor === x.id)
                    if (!c) return null
                    const sig = c.partialQ !== null && c.partialQ < FDR
                    return (
                      <tr
                        key={x.id}
                        onClick={() => setFactor(x.id)}
                        className={`cursor-pointer hover:bg-gray-50 ${factor === x.id ? 'bg-blue-50/50' : ''}`}
                      >
                        <td className="px-4 py-2 text-gray-800">{x.short}</td>
                        <td className="px-4 py-2 text-right text-gray-600">{fmtR(c.r)}</td>
                        <td className="px-4 py-2 text-right text-gray-800">
                          {fmtR(c.partialR)} <span className="text-gray-400">({fmtR(c.partialCiLow)}, {fmtR(c.partialCiHigh)})</span>
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600">{c.partialQ?.toFixed(3) ?? '—'}</td>
                        <td className="px-4 py-2">
                          {sig ? (
                            <span className="text-green-800">✔ Survives FDR 5%</span>
                          ) : (
                            <span className="text-gray-400">– Not reliable</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>

            <details className="bg-white border border-gray-200 rounded-lg">
              <summary className="px-4 py-3 text-sm font-semibold text-gray-700 cursor-pointer">Data table (all states)</summary>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-2 text-left">State</th>
                      <th className="px-4 py-2 text-right">Hospitals</th>
                      <th className="px-4 py-2 text-right">{outcomeLabel}</th>
                      {FACTORS.map(x => <th key={x.id} className="px-4 py-2 text-right">{x.short}</th>)}
                      <th className="px-4 py-2 text-right">Weeks used</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 tabular-nums">
                    {data.states.map(s => (
                      <tr key={s.state} onPointerEnter={() => setHighlight(s.state)} onPointerLeave={() => setHighlight(null)}>
                        <td className="px-4 py-1.5 font-medium text-gray-800">{s.state}</td>
                        <td className="px-4 py-1.5 text-right text-gray-600">{s.hospitals}</td>
                        <td className="px-4 py-1.5 text-right text-gray-800">{formatValue(s.outcome, data.unit)}</td>
                        {FACTORS.map(x => (
                          <td key={x.id} className="px-4 py-1.5 text-right text-gray-600">{formatValue(s[x.key] as number | null, x.unit)}</td>
                        ))}
                        <td className="px-4 py-1.5 text-right text-gray-400">{s.weeksUsed ?? '—'}/{s.weeksInWindow ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <p className="text-xs text-gray-400">
              Analysis run {data.runId} · strain weeks with under half of a state's hospitals reporting are excluded ·
              spend is price-standardized Medicare FFS spend per beneficiary · see the README for full method.
            </p>
          </div>
        )}
      </main>
    </>
  )
}

function Legend({ steps, left, right }: { steps: string[]; left: string; right: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <span>{left}</span>
      <div className="flex gap-[2px]" aria-hidden="true">
        {steps.map(c => <span key={c} className="w-5 h-3 rounded-[2px]" style={{ backgroundColor: c }} />)}
      </div>
      <span>{right}</span>
    </div>
  )
}
