import { useEffect, useState } from 'react'
import axios from 'axios'
import type { Benchmarks, Category, ContextSummary, Leaderboard, LeaderboardRow, MeasurePerformance, MeasurePerformanceRow, Scope, Spotlight, SpotlightHospital } from '../types'
import { GROUPS, SCOPE_INFO } from '../lib/quality'
import { CATEGORIES, STATES, formatMonth, formatValue } from '../lib/format'
import { GROUP_LABELS, NOTE_KINDS, PREDICTOR_LABELS, VERDICT_LABELS, drivers, formatScore, reshuffle } from '../lib/performance'
import { href } from '../lib/router'
import TabNav from '../components/TabNav'
import HowToRead from '../components/HowToRead'
import TrendChart, { TrendLegend } from '../components/TrendChart'

// A difference in a measure's units: "12 min", "0.4 pts", "0.30★".
function formatDiff(value: number, unit: string): string {
  const v = Math.abs(value)
  if (unit === 'minutes') return `${Math.round(v)} min`
  if (unit === 'percent') return `${v.toFixed(1)} pts`
  if (unit === 'stars') return `${v.toFixed(2)}★`
  return v.toFixed(2)
}

const percent = (share: number) => `${Math.max(0, Math.round(share * 100))}%`

export default function PerformanceView({ category }: { category: Category }) {
  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-10">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">Who beats expectations?</h2>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          A raw ranking can reward hospitals for easy circumstances and punish ones in hard places. Here each hospital is
          compared with what we'd <em>expect</em> given things it doesn't control: what kind of hospital it is, who its
          patients are, the community it serves and its state. Money and staffing are left out on purpose (see{' '}
          <a href={href('finances')} className="text-blue-600 hover:underline">Finances</a>). Before using context to judge
          anyone, the first step checks whether it actually explains anything.
        </p>
      </div>
      <ContextSection />
      <LeaderboardSection />
      <SpotlightSection />
      <BenchmarkSection />
      <MeasureSection category={category} />
      <HowToRead
        items={[
          {
            term: 'Expected score',
            text: "What a hospital would be predicted to score from its context alone: its type and ownership; its own share of low-income patients; its county's social vulnerability, poverty and uninsured rates and whether it's rural; its state's bed occupancy, Medicare spending and low-income share over the same period; and, for measures that aren't already risk-adjusted (ER times, process percentages, patient ratings), how complex its patients are (case mix and teaching). Hospital size, finances and staffing are deliberately not part of it: larger hospitals should keep credit for the quality advantage experience brings, and money and staffing are partly management's choices.",
          },
          {
            term: 'Difference',
            text: 'Actual minus expected, flipped where needed so positive always means better. Small hospitals are pulled toward their expected score first, because a handful of patients can make anyone look great or terrible by luck.',
          },
          {
            term: 'Clearly better / worse',
            text: 'Only when we are 95% sure the hospital beats or misses expectations by more than the typical difference between hospitals. Being slightly off the prediction isn\'t enough; most hospitals are "about as expected".',
          },
          {
            term: 'Overall score',
            text: "Each measure's difference in units of that measure's typical hospital-to-hospital spread (capped at 3), averaged within its group, then the groups weighted as in CMS's star rating (22% each for mortality, safety, readmission and patient experience, 12% for timely and effective care) over the groups the hospital has (at least 3). +1.00 means one typical spread better than expected across the board. Outcome and process scores use the same recipe on each half of the measures.",
          },
          {
            term: 'Share explained',
            text: "How much of the variation between hospitals context can predict, tested on hospitals the model didn't see when it was fitted (cross-validated), so it can't flatter itself.",
          },
        ]}
      />
    </main>
  )
}

function ContextSection() {
  const [rows, setRows] = useState<ContextSummary[] | null>(null)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    axios.get<ContextSummary[]>('/api/performance/context').then(res => setRows(res.data)).catch(() => setError(true))
  }, [])

  if (error) return <p className="text-red-500 text-sm">Couldn't load the context analysis.</p>
  if (!rows) return <p className="text-gray-400 text-sm">Loading…</p>

  const sorted = [...rows].sort((a, b) => b.r2Cv - a.r2Cv)
  const strong = sorted.filter(r => r.r2Cv >= 0.2)
  const some = sorted.filter(r => r.r2Cv >= 0.05 && r.r2Cv < 0.2)
  const barely = sorted.filter(r => r.r2Cv < 0.05)
  const list = (xs: ContextSummary[]) => xs.map((r, i) => (
    <span key={r.category}>
      {i > 0 && (i === xs.length - 1 ? ' and ' : ', ')}
      <strong>{percent(r.r2Cv)}</strong> of the differences in {r.label.toLowerCase().replace(/^er /, 'ER ')}
      {GROUP_LABELS[topGroupOf(r)] ? ` (mostly ${GROUP_LABELS[topGroupOf(r)].name.replace(/^(?!Medicare)\w/, c => c.toLowerCase())})` : ''}
    </span>
  ))
  const stateFactorMax = Math.max(
    ...rows.flatMap(r => ['crowding', 'spending', 'low_income'].map(g => r.importance[g] ?? 0))
  )
  const topGroupOf = (r: ContextSummary) => Object.entries(r.importance).sort((a, b) => b[1] - a[1])[0]?.[0]

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Step 1</p>
        <h3 className="text-lg font-semibold text-gray-800">Does context actually matter?</h3>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-700 space-y-2 leading-relaxed">
        {strong.length > 0 && (
          <p>
            <strong>Yes, a lot for some measures.</strong> Context explains {list(strong)}.
          </p>
        )}
        {some.length > 0 && (
          <p>
            <strong>Somewhat for others.</strong> It explains {list(some)}. CMS already adjusts these for how sick each
            hospital's patients were, so what's left is mostly about income and place.
          </p>
        )}
        {barely.length > 0 && (
          <p>
            <strong>Barely for {barely.map(r => r.label.toLowerCase()).join(', ')}</strong>, under{' '}
            {Math.ceil(Math.max(...barely.map(r => r.r2Cv)) * 100)}%: those scores are already heavily adjusted and
            smoothed by CMS.
          </p>
        )}
        {stateFactorMax < 0.05 && (
          <p>
            <strong>State conditions add little once the hospital's own context is known.</strong> Bed occupancy, Medicare
            spending and low-income share each add at most {(stateFactorMax * 100).toFixed(1)} percentage points of
            explanatory power for any measure. Differences between hospitals in the same state are far larger than
            differences between states, so hospital- and county-level context does the work, even where states differ on
            the States page.
          </p>
        )}
        <p>
          Which facts predict hospitals' <em>actual</em> results, including the money, staffing and track record left out
          here? See{' '}
          <a href={href('predictors')} className="text-blue-600 hover:underline">what predicts results</a>, which tests
          the assumptions this project started from.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">Measure</th>
              <th className="px-4 py-2 text-left">Share explained by context</th>
              <th className="px-4 py-2 text-left">Biggest factor</th>
              <th className="px-4 py-2 text-left">Effect of adjusting on the ranking</th>
              <th className="px-4 py-2 text-right">Clearly better / worse</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map(r => {
              const [topGroup, topValue] = Object.entries(r.importance).sort((a, b) => b[1] - a[1])[0] ?? ['', 0]
              return (
                <tr key={r.category} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800">{r.label}</div>
                    <button
                      type="button"
                      onClick={() => setOpen(open === r.category ? null : r.category)}
                      className="text-xs text-blue-600 hover:underline mt-0.5"
                      aria-expanded={open === r.category}
                    >
                      {open === r.category ? 'Hide factor details' : 'Show factor details'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-28 h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#cde2fb' }} aria-hidden="true">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(1, r.r2Cv * 100)}%`, backgroundColor: '#2a78d6' }} />
                      </div>
                      <span className="tabular-nums text-gray-800">{percent(r.r2Cv)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {topValue >= 0.01 ? GROUP_LABELS[topGroup]?.name ?? topGroup : <span className="text-gray-400">Nothing much</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{reshuffle(r.rankAgreement)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    <span className="text-green-800">{r.better}</span> / <span className="text-red-800">{r.worse}</span>
                    <span className="text-gray-400"> of {r.hospitals.toLocaleString('en-US')}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {open && <FactorDetails summary={rows.find(r => r.category === open)!} />}
      </div>
    </section>
  )
}

// Each predictor's effect, with its 95% range, in the measure's own units.
function FactorDetails({ summary }: { summary: ContextSummary }) {
  return (
    <div className="border-t border-gray-200 bg-gray-50 px-4 py-4 text-sm">
      <p className="font-medium text-gray-800">{summary.label}: what each factor adds to the expected score</p>
      <p className="text-xs text-gray-500 mt-1">
        Holding the other factors fixed. "No clear effect" means the 95% range includes zero.
      </p>
      <ul className="mt-3 space-y-1.5">
        {Object.entries(summary.coefficients)
          .filter(([name]) => name !== 'intercept' && PREDICTOR_LABELS[name])
          .map(([name, { estimate, se }]) => {
            const clear = Math.abs(estimate) > 1.96 * se
            const better = (estimate > 0) === summary.higherIsBetter
            return (
              <li key={name} className="flex flex-wrap justify-between gap-x-4">
                <span className="text-gray-700">{PREDICTOR_LABELS[name]}</span>
                <span className={clear ? (better ? 'text-green-800' : 'text-red-800') : 'text-gray-400'}>
                  {clear
                    ? `${estimate > 0 ? '+' : '−'}${formatDiff(estimate, summary.unit)} (±${formatDiff(1.96 * se, summary.unit)}), ${better ? 'better' : 'worse'}`
                    : 'No clear effect'}
                </span>
              </li>
            )
          })}
      </ul>
      <p className="text-xs text-gray-500 mt-3">
        Explanatory power lost if each group were left out:{' '}
        {Object.entries(summary.importance)
          .map(([g, v]) => `${GROUP_LABELS[g]?.name ?? g} ${Math.max(0, v * 100).toFixed(1)} pts`)
          .join(' · ')}
      </p>
    </div>
  )
}

const LEADERBOARD_SCOPES: Scope[] = ['overall', 'outcome', 'process', ...GROUPS]

function LeaderboardSection() {
  const [state, setState] = useState('')
  const [scope, setScope] = useState<Scope>('overall')
  // Full-service hospitals by default, as CMS compares like with like.
  const [groups, setGroups] = useState('5')
  const [data, setData] = useState<Leaderboard | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    axios
      .get<Leaderboard>('/api/performance', { params: { state: state || undefined, limit: 10, scope, groups: groups || undefined } })
      .then(res => {
        setData(res.data)
        setError(false)
      })
      .catch(() => setError(true))
  }, [state, scope, groups])

  // Within a state the server's ranks are national, so number the lists.
  const rank = (list: 'top' | 'bottom') => (h: LeaderboardRow, i: number) =>
    !state ? h.nationalRank : list === 'top' ? i + 1 : (data?.hospitals ?? 0) - i

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Step 2</p>
          <h3 className="text-lg font-semibold text-gray-800">Who beats expectations the most</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            Measures are averaged within five groups (mortality, safety, readmission, patient experience, timely and
            effective care), then the groups are weighted as in CMS's star rating: 22% each, 12% for timely and
            effective care. Outcome and process scores split the same measures along{' '}
            <a href={href('framework')} className="text-blue-600 hover:underline">Donabedian's</a> line.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            Compare with
            <select
              value={groups}
              onChange={e => setGroups(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white"
            >
              <option value="">All hospitals</option>
              <option value="5">Full-service (all 5 groups)</option>
              <option value="4">4 measure groups</option>
              <option value="3">3 measure groups</option>
            </select>
          </label>
          <select
            value={state}
            onChange={e => setState(e.target.value)}
            aria-label="State"
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white"
          >
            <option value="">Nationwide</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-1" role="group" aria-label="Score">
        {LEADERBOARD_SCOPES.map(s => (
          <button
            key={s} type="button" onClick={() => setScope(s)} aria-pressed={scope === s} title={SCOPE_INFO[s].help}
            className={`px-3 py-1.5 rounded-md text-sm ${scope === s ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'}`}
          >
            {SCOPE_INFO[s].label}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500 -mt-2">
        {SCOPE_INFO[scope].help}{' '}
        {groups === '5'
          ? 'Showing full-service hospitals, which report all five groups. Specialty hospitals (orthopedic, surgical) report fewer groups; CMS compares hospitals only with others reporting the same number, and so does the "Compare with" menu.'
          : !groups && 'Specialty hospitals (orthopedic, surgical) report fewer groups and often top the full list.'}
      </p>

      {error && <p className="text-red-500 text-sm">Couldn't load the leaderboard.</p>}
      {data && (
        <>
          <p className="text-sm text-gray-600">
            Of {data.hospitals.toLocaleString('en-US')} hospitals{state ? ` in ${state}` : ''},{' '}
            <strong className="text-green-800">{data.better}</strong> are clearly better than expected on{' '}
            {scope === 'overall' ? 'the overall score' : SCOPE_INFO[scope].label.toLowerCase()} and{' '}
            <strong className="text-red-800">{data.worse}</strong> clearly worse; the rest are within the normal range.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <LeaderboardTable title="Most above expectations" tone="text-green-700" rows={data.top} rank={rank('top')} />
            <LeaderboardTable title="Most below expectations" tone="text-red-700" rows={data.bottom} rank={rank('bottom')} />
          </div>
        </>
      )}
    </section>
  )
}

function LeaderboardTable({ title, tone, rows, rank }: {
  title: string
  tone: string
  rows: Leaderboard['top']
  rank: (h: LeaderboardRow, i: number) => number
}) {
  return (
    <div>
      <h4 className={`font-semibold mb-2 ${tone}`}>{title}</h4>
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Hospital</th>
              <th className="px-3 py-2 text-right" title="Average difference from expected, in typical hospital-to-hospital spreads">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((h, i) => (
              <tr key={h.id} className="align-top">
                <td className="px-3 py-2 text-gray-400 tabular-nums">{rank(h, i)}</td>
                <td className="px-3 py-2">
                  <a href={href('hospitals', h.id)} className="font-medium text-gray-800 hover:text-blue-700 hover:underline">{h.name}</a>
                  <div className="text-xs text-gray-500">{h.city}, {h.state} · {h.measures} measures in {h.groups} {h.groups === 1 ? 'group' : 'groups'}</div>
                  {h.verdict !== 'as_expected' && (
                    <span className={`inline-block mt-1 px-1.5 py-0.5 rounded border text-xs ${VERDICT_LABELS[h.verdict].className}`}>
                      {VERDICT_LABELS[h.verdict].label}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-700 whitespace-nowrap">
                  {formatScore(h.score)}
                  <div className="text-xs text-gray-400 font-sans">±{(1.96 * h.scoreSe).toFixed(2)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const categoryLabel = (c: string) => CATEGORIES.find(x => x.id === c)?.label ?? c
const MEASURE_ORDER = CATEGORIES.map(c => c.id)

function SpotlightSection() {
  const [data, setData] = useState<Spotlight | null>(null)
  const [error, setError] = useState(false)
  const [side, setSide] = useState<'top' | 'bottom'>('top')

  useEffect(() => {
    axios.get<Spotlight>('/api/performance/spotlight').then(res => setData(res.data)).catch(() => setError(true))
  }, [])

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Step 3</p>
          <h3 className="text-lg font-semibold text-gray-800">Up close: the top 5 and bottom 5</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            What puts each hospital at the top or bottom, how its scores have moved since 2018, and what's been reported
            about it.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5" role="group" aria-label="Which end of the ranking">
          {(['top', 'bottom'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              aria-pressed={side === s}
              className={`px-3 py-1 text-sm rounded ${side === s ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {s === 'top' ? 'Top 5' : 'Bottom 5'}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-red-500 text-sm">Couldn't load the spotlight.</p>}
      {data && (
        <>
          <TrendLegend />
          <div className="space-y-4">
            {data[side].map(h => <SpotlightCard key={h.id} h={h} direction={side === 'top' ? 1 : -1} of={data.hospitals} />)}
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            Trends use each year's last CMS release; measurement periods are one to three years long and overlap, so
            neighboring points share data. News items were found by searching for each hospital, summarized in our own
            words, and last checked {formatMonth(data.notesChecked)}. Statements marked as a hospital press release are the
            hospital's own claims.
          </p>
        </>
      )}
    </section>
  )
}

function SpotlightCard({ h, direction, of }: { h: SpotlightHospital; direction: 1 | -1; of: number }) {
  const { main, counter } = drivers(h.breakdown, direction)
  const line = (m: SpotlightHospital['breakdown'][number]) =>
    `${categoryLabel(m.category)}: ${formatValue(m.actual, m.unit)} vs. ${formatValue(m.expected, m.unit)} expected`

  return (
    <article className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <a href={href('hospitals', h.id)} className="font-semibold text-gray-900 hover:text-blue-700 hover:underline">
            <span className="text-gray-400 tabular-nums mr-1.5">#{h.nationalRank.toLocaleString('en-US')}</span>
            {h.name}
          </a>
          <div className="text-xs text-gray-500 mt-0.5">
            {h.city}, {h.state} · {h.hospitalType} · of {of.toLocaleString('en-US')} ranked
          </div>
        </div>
        <div className="text-right">
          <span className="font-mono text-gray-800">{formatScore(h.score)}</span>
          <span className="text-xs text-gray-400"> ±{(1.96 * h.scoreSe).toFixed(2)}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2 text-xs">
        <span className={`px-1.5 py-0.5 rounded border ${VERDICT_LABELS[h.verdict].className}`}>{VERDICT_LABELS[h.verdict].label}</span>
        {h.overallRating !== null && (
          <span className="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-700">
            CMS overall rating {h.overallRating}★
          </span>
        )}
        {h.usNewsHonorRoll && (
          <span className="px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-800">U.S. News Honor Roll</span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 text-sm">
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {direction === 1 ? 'Why it ranks high' : 'Why it ranks low'}
          </h4>
          <ul className="mt-1 space-y-0.5 text-gray-700">
            {main.map(m => <li key={m.category}>{line(m)}</li>)}
          </ul>
          {counter && (
            <p className="mt-1 text-gray-500">
              {direction === 1 ? 'Weak spot' : 'Bright spot'}: {line(counter).replace(/^./, c => c.toLowerCase())}
            </p>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">In the news</h4>
          {h.notes.length === 0 ? (
            <p className="mt-1 text-gray-500">No recent coverage found.</p>
          ) : (
            <ul className="mt-1 space-y-2">
              {h.notes.map(n => (
                <li key={n.url} className="text-gray-700">
                  <span className="text-xs text-gray-500">{NOTE_KINDS[n.kind]} · </span>
                  {n.summary}{' '}
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline whitespace-nowrap">
                    {n.source}, {formatMonth(n.published)} ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3 mt-4 pt-3 border-t border-gray-100">
        {MEASURE_ORDER.map(c => {
          const m = h.breakdown.find(x => x.category === c)
          const points = h.history[c] ?? []
          if (!m && points.length === 0) return null
          return (
            <TrendChart
              key={c}
              label={categoryLabel(c)}
              points={points}
              unit={m?.unit ?? 'number'}
              higherIsBetter={m?.higherIsBetter ?? c === 'satisfaction'}
            />
          )
        })}
      </div>
    </article>
  )
}

function BenchmarkSection() {
  const [data, setData] = useState<Benchmarks | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    axios.get<Benchmarks>('/api/performance/benchmarks').then(res => setData(res.data)).catch(() => setError(true))
  }, [])

  if (error) return <p className="text-red-500 text-sm">Couldn't load the comparison with other ratings.</p>
  if (!data) return null

  const honor = data.usNewsHonorRoll.hospitals.filter(h => h.nationalRank !== null)
  const ranks = honor.map(h => h.nationalRank!).sort((a, b) => a - b)
  const median = ranks.length ? (ranks[(ranks.length - 1) >> 1] + ranks[ranks.length >> 1]) / 2 : null
  const third = Math.round(data.ranked / 3)
  const inTopThird = ranks.filter(r => r <= third).length
  const inTop5 = ranks.filter(r => r <= 5).length
  const lowest = [...honor].sort((a, b) => b.nationalRank! - a.nationalRank!).slice(0, 3)
  const rated = data.stars.byRating.filter(r => r.stars !== null)
  const strength = data.stars.spearman >= 0.7 ? 'strong' : data.stars.spearman >= 0.4 ? 'moderate' : 'weak'

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Step 4</p>
        <h3 className="text-lg font-semibold text-gray-800">Sanity check: does this agree with other ratings?</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          No ranking is ground truth, but a new one that disagreed with everything else would be a warning sign. Two
          comparisons: CMS's own star rating, and the U.S. News Honor Roll.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm">
          <h4 className="font-semibold text-gray-800">CMS overall star rating</h4>
          <p className="text-gray-700 mt-1 leading-relaxed">
            Higher-rated hospitals rank higher here, a <strong>{strength}</strong> agreement (rank correlation{' '}
            {data.stars.spearman.toFixed(2)} across {data.stars.hospitals.toLocaleString('en-US')} hospitals). Expect
            some overlap by design: CMS stars draw on dozens of measures in the same five areas, but don't adjust for
            hospital type or state.
          </p>
          <table className="w-full mt-3">
            <thead className="text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="py-1 text-left">CMS rating</th>
                <th className="py-1 text-left">Typical rank here</th>
                <th className="py-1 text-right">Clearly better / worse</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rated.map(r => (
                <tr key={r.stars}>
                  <td className="py-1.5 text-gray-800 whitespace-nowrap">
                    {r.stars}★ <span className="text-xs text-gray-400">({r.hospitals.toLocaleString('en-US')})</span>
                  </td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#cde2fb' }} aria-hidden="true">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(2, (1 - r.medianRank / data.ranked) * 100)}%`, backgroundColor: '#2a78d6' }} />
                      </div>
                      <span className="tabular-nums text-gray-700">#{Math.round(r.medianRank).toLocaleString('en-US')}</span>
                    </div>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    <span className="text-green-800">{r.better}</span> / <span className="text-red-800">{r.worse}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-400 mt-2">Typical rank = median of {data.ranked.toLocaleString('en-US')}; longer bar = higher.</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm">
          <h4 className="font-semibold text-gray-800">U.S. News Best Hospitals Honor Roll {data.usNewsHonorRoll.edition}</h4>
          <p className="text-gray-700 mt-1 leading-relaxed">
            <strong>{inTop5} of our top 5</strong> are on its 20-hospital Honor Roll. Of all {ranks.length},{' '}
            {inTopThird} rank in our top third and the typical one is #{median?.toLocaleString('en-US')} of{' '}
            {data.ranked.toLocaleString('en-US')}.
          </p>
          <RankStrip ranks={honor.map(h => ({ id: h.id, name: h.name, rank: h.nationalRank! }))} of={data.ranked} />
          <p className="text-gray-700 mt-3 leading-relaxed">
            The two measure different things. U.S. News focuses on complex specialty care, such as cancer surgery and
            cardiology, while our five measures include everyday care where big academic centers often struggle. The
            lowest-ranked Honor Roll hospitals here each have one weak measure:
          </p>
          <ul className="mt-1 space-y-0.5 text-gray-700">
            {lowest.map(h => (
              <li key={h.id}>
                <a href={href('hospitals', h.id)} className="hover:text-blue-700 hover:underline">{h.name}</a>{' '}
                <span className="text-gray-400">(#{h.nationalRank!.toLocaleString('en-US')})</span>
                {h.weakest && (
                  <span className="text-gray-500">
                    : {categoryLabel(h.weakest.category).toLowerCase().replace(/^er /, 'ER ')}{' '}
                    {formatValue(h.weakest.actual, h.weakest.unit)} vs. {formatValue(h.weakest.expected, h.weakest.unit)} expected
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-400 mt-2">
            Source:{' '}
            <a href={data.usNewsHonorRoll.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              U.S. News, {formatMonth(data.usNewsHonorRoll.published)} ↗
            </a>
            . The Honor Roll is unranked, so only membership is compared.
          </p>
        </div>
      </div>
    </section>
  )
}

// Where each Honor Roll hospital falls on our ranking, best at the left.
function RankStrip({ ranks, of }: { ranks: { id: string; name: string; rank: number }[]; of: number }) {
  const [active, setActive] = useState<string | null>(null)
  const shown = ranks.find(r => r.id === active)
  const pct = (rank: number) => ((rank - 1) / Math.max(1, of - 1)) * 100
  return (
    <div className="mt-3">
      <div className="relative h-6" role="img" aria-label={`Honor Roll hospitals' ranks here: ${ranks.map(r => `#${r.rank}`).join(', ')} of ${of}`}>
        <div className="absolute left-0 right-0 top-1/2 h-px bg-gray-300" />
        {[1 / 3, 2 / 3].map(t => (
          <div key={t} className="absolute top-1 bottom-1 w-px bg-gray-200" style={{ left: `${t * 100}%` }} />
        ))}
        {ranks.map(r => (
          <button
            key={r.id}
            type="button"
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center"
            style={{ left: `${pct(r.rank)}%` }}
            onMouseEnter={() => setActive(r.id)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(r.id)}
            onBlur={() => setActive(null)}
            aria-label={`${r.name}: #${r.rank}`}
          >
            <span className="block w-2.5 h-2.5 rounded-full border-2 border-white" style={{ backgroundColor: '#2a78d6', boxShadow: active === r.id ? '0 0 0 2px #1e40af' : undefined }} />
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-gray-400 mt-0.5">
        <span>#1 (best)</span>
        <span>{shown ? `${shown.name} · #${shown.rank.toLocaleString('en-US')}` : 'Top third | middle | bottom third'}</span>
        <span>#{of.toLocaleString('en-US')}</span>
      </div>
    </div>
  )
}

function MeasureSection({ category }: { category: Category }) {
  const [data, setData] = useState<MeasurePerformance | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    axios
      .get<MeasurePerformance>(`/api/performance/${category}`, { params: { limit: 8 } })
      .then(res => {
        setData(res.data)
        setError(false)
      })
      .catch(() => setError(true))
  }, [category])

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Step 5</p>
        <h3 className="text-lg font-semibold text-gray-800">Measure by measure</h3>
        <p className="text-sm text-gray-500 mt-1">
          The hospitals furthest from what their context predicts on each measure.
        </p>
      </div>
      <div className="-mx-6">
        <TabNav categories={CATEGORIES} active={category} hrefFor={c => href('performance', c)} />
      </div>
      {error && <p className="text-red-500 text-sm">Couldn't load this measure.</p>}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MeasureTable title="Most above expectations" tone="text-green-700" data={data} rows={data.over} />
          <MeasureTable title="Most below expectations" tone="text-red-700" data={data} rows={data.under} />
        </div>
      )}
    </section>
  )
}

function MeasureTable({ title, tone, data, rows }: {
  title: string
  tone: string
  data: MeasurePerformance
  rows: MeasurePerformanceRow[]
}) {
  return (
    <div>
      <h4 className={`font-semibold mb-2 ${tone}`}>{title}</h4>
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left">Hospital</th>
              <th className="px-3 py-2 text-right">Actual</th>
              <th className="px-3 py-2 text-right">Expected</th>
              <th className="px-3 py-2 text-right" title="After pulling small hospitals toward expected; ± is the 95% range">Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(h => (
              <tr key={h.id} className="align-top">
                <td className="px-3 py-2">
                  <a href={href('hospitals', h.id)} className="font-medium text-gray-800 hover:text-blue-700 hover:underline">{h.name}</a>
                  <div className="text-xs text-gray-500">{h.city}, {h.state}</div>
                  {h.verdict !== 'as_expected' && (
                    <span className={`inline-block mt-1 px-1.5 py-0.5 rounded border text-xs ${VERDICT_LABELS[h.verdict].className}`}>
                      {VERDICT_LABELS[h.verdict].label}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-800">{formatValue(h.actual, data.unit)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatValue(h.expected, data.unit)}</td>
                <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                  <span className={h.adjustedGap >= 0 ? 'text-green-800' : 'text-red-800'}>
                    {h.adjustedGap >= 0 ? 'better by ' : 'worse by '}
                    {formatDiff(h.adjustedGap, data.unit)}
                  </span>
                  <div className="text-xs text-gray-400">±{formatDiff(1.96 * h.gapSe, data.unit)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
