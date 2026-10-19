import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import type { Category, Correlation, Factor, StateAnalysis, StateRow } from '../types'
import { CATEGORIES, FACTORS, MEASURE_GUIDE, correlationStrength, formatMonth, formatValue } from '../lib/format'
import { DIVERGING_STEPS, SEQUENTIAL_STEPS, divergingColor, sequentialColor } from '../lib/colors'
import { href } from '../lib/router'
import TabNav from '../components/TabNav'
import TileMap from '../components/TileMap'
import Scatter from '../components/Scatter'
import HowToRead from '../components/HowToRead'

const FDR = 0.05
// Lowercase for mid-sentence use, leaving acronyms like 'ER' intact.
const midSentence = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1)).replace(/ ([A-Z])([a-z])/g, (_, a, b) => ' ' + a.toLowerCase() + b).replace(/-([A-Z])/g, (_, a) => '-' + a.toLowerCase())
const fmtR = (r: number | null) => (r === null ? '—' : (r >= 0 ? '+' : '−') + Math.abs(r).toFixed(2))

// "States with higher ICU occupancy tend to have worse ER wait times."
function finding(c: Correlation, factorNoun: string, outcomeLabel: string, higherIsBetter: boolean): string {
  if (!holdsUp(c)) {
    return `No reliable link between ${factorNoun} and ${midSentence(outcomeLabel)}: the pattern is small enough that it could be chance.`
  }
  return `States with higher ${factorNoun} tend to have ${worseWhenHigher(c, higherIsBetter) ? 'worse' : 'better'} ${midSentence(outcomeLabel)}.`
}

const holdsUp = (c: Correlation) => c.partialR !== null && c.partialQ !== null && c.partialQ < FDR
const worseWhenHigher = (c: Correlation, higherIsBetter: boolean) => ((c.partialR ?? c.r) > 0) !== higherIsBetter

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
          {s.hospitals} hospitals{s.cases && MEASURE_GUIDE[category]?.caseNoun ? ` · ${Math.round(s.cases).toLocaleString('en-US')} ${MEASURE_GUIDE[category].caseNoun}` : ''}
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
        {!data && loading && <p className="text-center text-gray-400 py-16">Loading state comparison…</p>}

        {data && !error && (
          <div className={`space-y-6 ${loading ? 'opacity-60' : ''} transition-opacity`}>
            <div>
              <h2 className="text-xl font-semibold text-gray-800">{data.label}: how states compare</h2>
              <p className="text-sm text-gray-600 mt-1">
                Do states whose hospitals are more crowded, or where Medicare spends more, get better or worse results?
                Each state's score is the average of its hospitals, with busier hospitals counting for more ({direction}).
                Crowding and spending are measured over the same period the scores cover,{' '}
                {formatMonth(data.windowStart)} – {formatMonth(data.windowEnd)}, for all 50 states plus DC.
              </p>
              {MEASURE_GUIDE[category] && (
                <p className="text-xs text-gray-500 mt-2">
                  <span className="font-medium text-gray-600">The score:</span> {MEASURE_GUIDE[category].score}
                </p>
              )}
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
                  title={x.description}
                  className={`px-3 py-1 rounded-full border ${
                    factor === x.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  {x.short}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 -mt-3">
              <span className="font-medium text-gray-600">{f.label}:</span> {f.description}
            </p>

            {corr && (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <p className="text-gray-800 font-medium">{finding(corr, f.noun, outcomeLabel, data.higherIsBetter)}</p>
                <ul className="text-sm text-gray-600 mt-2 space-y-1">
                  <li>
                    <span className="text-gray-500">Strength:</span>{' '}
                    {correlationStrength(corr.partialR)} ({fmtR(corr.partialR)} on a scale from −1 to +1, where 0 means no
                    relationship), likely somewhere between {fmtR(corr.partialCiLow)} and {fmtR(corr.partialCiHigh)}.
                  </li>
                  <li>
                    <span className="text-gray-500">Fluke check:</span>{' '}
                    {holdsUp(corr)
                      ? `passes (q = ${corr.partialQ!.toFixed(3)}, under the 0.05 bar), even after accounting for testing 25 comparisons at once.`
                      : `doesn't pass (q = ${corr.partialQ?.toFixed(3) ?? '—'}, over the 0.05 bar), so with 25 comparisons tested, a pattern this size could easily be chance.`}
                  </li>
                  <li>
                    <span className="text-gray-500">Already adjusted for:</span> how many low-income patients each state has,
                    so this isn't just poorer states doing worse.
                  </li>
                </ul>
                <p className="text-xs text-gray-400 mt-2">
                  A pattern across {corr.n} states, not proof that one causes the other.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">
                    {colorBy === 'outcome' ? `${outcomeLabel} compared with the national average` : `${f.label}, by state`}
                  </h3>
                  <div className="flex items-center text-xs border border-gray-300 rounded-md overflow-hidden shrink-0" role="group" aria-label="Color map by">
                    <span className="px-2 text-gray-500 bg-gray-50 self-stretch flex items-center border-r border-gray-300">Color by</span>
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
                      <Legend steps={DIVERGING_STEPS} left="Worse than national" right="Better than national" />
                    ) : (
                      <Legend steps={SEQUENTIAL_STEPS} left={`Lower ${f.noun}`} right="Higher" />
                    )
                  }
                />
              </section>

              <section className="bg-white border border-gray-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700">Each dot is a state</h3>
                <p className="text-xs text-gray-500 mb-3">
                  The gray line is the overall trend; a steeper line means a stronger link. Labeled states are the
                  furthest from the trend. Hover a dot or a map tile for its numbers.
                </p>
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
              <h3 className="text-sm font-semibold text-gray-700 px-4 pt-4">Everything we compared {midSentence(outcomeLabel)} against</h3>
              <p className="text-xs text-gray-500 px-4 mt-1">Click a row to chart it. The terms are explained below the table.</p>
              <table className="w-full text-sm mt-2">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-2 text-left">Compared with</th>
                    <th className="px-4 py-2 text-left">Direction</th>
                    <th className="px-4 py-2 text-right" title="Correlation after adjusting for low-income patients, from −1 to +1">Strength</th>
                    <th className="px-4 py-2 text-right" title="95% confidence interval for the adjusted correlation">Likely range</th>
                    <th className="px-4 py-2 text-right" title="False-discovery-rate q-value; under 0.05 passes">Fluke check (q)</th>
                    <th className="px-4 py-2 text-left">Holds up?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 tabular-nums">
                  {FACTORS.map(x => {
                    const c = data.correlations.find(k => k.factor === x.id)
                    if (!c) return null
                    const sig = holdsUp(c)
                    return (
                      <tr
                        key={x.id}
                        onClick={() => setFactor(x.id)}
                        className={`cursor-pointer hover:bg-gray-50 ${factor === x.id ? 'bg-blue-50/50' : ''}`}
                      >
                        <td className="px-4 py-2 text-gray-800">{x.short}</td>
                        <td className={`px-4 py-2 ${sig ? 'text-gray-700' : 'text-gray-400'}`}>
                          Higher → {worseWhenHigher(c, data.higherIsBetter) ? 'worse' : 'better'}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-800">
                          {fmtR(c.partialR)} <span className="text-gray-400">{correlationStrength(c.partialR)}</span>
                        </td>
                        <td className="px-4 py-2 text-right text-gray-500">{fmtR(c.partialCiLow)} to {fmtR(c.partialCiHigh)}</td>
                        <td className="px-4 py-2 text-right text-gray-600">{c.partialQ?.toFixed(3) ?? '—'}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {sig ? (
                            <span className="text-green-800">✔ Yes</span>
                          ) : (
                            <span className="text-gray-400">– Could be chance</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>

            <HowToRead
              open
              items={[
                {
                  term: 'Direction',
                  text: `What tends to happen to ${midSentence(outcomeLabel)} in states where the factor is higher. Gray means the pattern didn't hold up, so the direction shouldn't be trusted.`,
                },
                {
                  term: 'Strength',
                  text: 'A correlation, from −1 to +1. 0 means no relationship; ±1 means the two move in perfect lockstep. Roughly: under 0.3 is weak, 0.3–0.5 moderate, above 0.5 strong. The sign only says which way the numbers move together; "Direction" translates it into better or worse.',
                },
                {
                  term: 'Adjusted',
                  text: 'Poorer populations tend to have worse health outcomes regardless of their hospitals. To avoid mistaking that for a crowding or spending effect, every strength is adjusted for each state\'s share of patients on both Medicare and Medicaid, a standard stand-in for low income.',
                },
                {
                  term: 'Likely range',
                  text: "With only 51 states, the strength is an estimate. This is its 95% confidence interval: the true value very likely lies inside. If the range crosses 0, there may be no relationship at all. The range treats each comparison on its own, so a range that stays clear of 0 can still fail the stricter fluke check.",
                },
                {
                  term: 'Fluke check (q)',
                  text: 'We tested 25 combinations (5 outcomes × 5 factors). Test that many and one or two will look impressive purely by chance. The q-value (a false-discovery-rate correction) accounts for that; below 0.05 means the pattern holds up even so.',
                },
                {
                  term: 'Holds up?',
                  text: '"Yes" when the fluke check passes. It still means "these tend to go together," not "one causes the other."',
                },
              ]}
            />

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
                      <th className="px-4 py-2 text-right" title="Weeks with reliable CDC reporting (at least half of the state's hospitals reporting), out of the weeks in the period">
                        Weeks of CDC data
                      </th>
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
              Weeks when fewer than half of a state's hospitals reported to the CDC are left out; that mostly affects
              mid-2024, when reporting was voluntary. Spending covers traditional Medicare only. Full method in the
              project README. Analysis run {data.runId}.
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
