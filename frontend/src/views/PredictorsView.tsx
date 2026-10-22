import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import type { Category, MeasurePredictors, PersistencePoint, PredictorsOverview } from '../types'
import { CATEGORIES, formatMonth } from '../lib/format'
import { divergingColor, textOn } from '../lib/colors'
import { ASSUMPTIONS, GROUP_INFO, MODEL_STEPS, VARIABLE_LABELS, formatR, share, strengthOf } from '../lib/predictors'
import { href } from '../lib/router'
import HowToRead from '../components/HowToRead'

const SERIES = '#2a78d6'
const SURFACE = '#ffffff'

const labelOf = (c: Category) => CATEGORIES.find(x => x.id === c)?.label ?? c
const lower = (c: Category) => labelOf(c).toLowerCase().replace(/^er /, 'ER ')
const order = (ms: MeasurePredictors[]) =>
  CATEGORIES.map(c => ms.find(m => m.category === c.id)).filter((m): m is MeasurePredictors => !!m)
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const points = (v: number) => `${(Math.max(0, v) * 100).toFixed(1)} pts`

export default function PredictorsView() {
  const [data, setData] = useState<PredictorsOverview | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    axios.get<PredictorsOverview>('/api/predictors').then(res => setData(res.data)).catch(() => setError(true))
  }, [])

  if (error) return <p className="text-center text-red-500 py-16">Couldn't load the predictor analysis.</p>
  if (!data) return <p className="text-center text-gray-400 py-16">Loading…</p>
  if (data.measures.length === 0) return <p className="text-center text-gray-400 py-16">No predictor analysis yet.</p>
  return <PredictorsReport data={data} />
}

// The page body, separate from loading so it can be rendered from fixtures.
export function PredictorsReport({ data }: { data: PredictorsOverview }) {
  const measures = order(data.measures)
  const best = (f: (m: MeasurePredictors) => number) => [...measures].sort((a, b) => f(b) - f(a))[0]
  const topAssumed = best(m => m.models.assumptions)
  const topProfit = best(m => m.groups.profit.alone)
  const topTrack = best(m => m.models.with_track_record)
  const oldest = (m: MeasurePredictors) => m.persistence.find(p => !p.overlapping)

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-10">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">What predicts a hospital's results?</h2>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed max-w-3xl">
          This project started from a few assumptions: hospitals would do worse where the state's hospitals were packed
          full or where Medicare spent less, in poorer states, and when they were losing money. This page tests those
          assumptions against every other public fact we could gather about{' '}
          {Math.max(...measures.map(m => m.hospitals)).toLocaleString('en-US')} hospitals, predicting each measure's <em>actual</em> published scores. Unlike the{' '}
          <a href={href('performance')} className="text-blue-600 hover:underline">expected scores</a>, anything counts here,
          including money, staffing and past results, because the question is what goes along with good results, not what
          to grade on a curve. These are associations, not causes.
        </p>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat value={share(topAssumed.models.assumptions)} label={`the most our first assumptions explain of any measure (${lower(topAssumed.category)})`} />
        <Stat value={share(topProfit.groups.profit.alone)} label="the most profit margins explain of any measure" />
        <Stat value={share(topTrack.models.with_track_record)} label={`of the differences in ${lower(topTrack.category)} predicted once we add the hospital's own past`} />
        {oldest(topTrack) && (
          <Stat
            value={formatR(oldest(topTrack)!.r)}
            label={`correlation between ${lower(topTrack.category)} ${Math.round(oldest(topTrack)!.yearsBack)} years ago and today`}
          />
        )}
      </section>

      <AssumptionsSection measures={measures} />
      <SearchSection measures={measures} />
      <PersistenceSection measures={measures} />
      <OneThingSection measures={measures} correlations={data.correlations} />
      <TakeawaysSection measures={measures} />

      <HowToRead
        items={[
          {
            term: 'Share explained',
            text: "How much of the differences between hospitals a set of facts can predict (cross-validated R²): the model is fitted on four fifths of hospitals and scored on the fifth it didn't see, five times over, so adding useless facts can't make it look better. 0% means no better than guessing the average.",
          },
          {
            term: 'Adds on top of everything else',
            text: 'How much the share explained drops when that group is removed from the model with every hospital fact we have. A group can predict a lot alone and add nothing on top, when other facts carry the same information (big hospitals are also busy, teaching and urban).',
          },
          {
            term: 'Correlation (r)',
            text: 'From −1 to 1, flipped where needed so positive always means "goes with better scores". Around 0.1 is weak, 0.3 moderate, 0.5 and up strong.',
          },
          {
            term: 'Earlier score',
            text: "The hospital's score on the same measure from the most recent earlier period that shares no months with the current one, so the two don't count the same patients.",
          },
          {
            term: 'Where the facts come from',
            text: "CMS Care Compare and its archives (scores and history), CMS payment files and cost reports (patients, complexity, finances, staffing), CDC (state hospital strain, county social vulnerability), Medicare's Geographic Variation file (state spending) and AHRQ's Compendium of U.S. Health Systems (system membership).",
          },
          {
            term: 'Associations, not causes',
            text: 'A struggling hospital may hire agency staff because it is struggling; big hospitals may have long ER waits because they draw the sickest patients. These numbers say what goes together, not what to change.',
          },
        ]}
      />
      {data.computedAt && <p className="text-xs text-gray-400">Computed {formatMonth(data.computedAt)} (analysis run {data.runId}).</p>}
    </main>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-2xl font-semibold text-gray-900 tabular-nums">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

function SectionTitle({ step, title }: { step: number; title: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Part {step}</p>
      <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
    </div>
  )
}

// Correlation cell: diverging blue (goes with better) / red (worse), with the
// value printed so color is never the only cue.
function RCell({ r, n }: { r: number; n: number }) {
  const fill = divergingColor(Math.max(-1, Math.min(1, r / 0.5)))
  return (
    <td className="px-1 py-1">
      <div
        className="rounded px-2 py-1.5 text-center tabular-nums text-xs"
        style={{ backgroundColor: fill, color: textOn(fill) }}
        title={`r = ${formatR(r)} over ${n.toLocaleString('en-US')} hospitals`}
      >
        {formatR(r)}
      </div>
    </td>
  )
}

function AssumptionsSection({ measures }: { measures: MeasurePredictors[] }) {
  const crowd = measures.map(m => ({ m, r: m.variables.state_crowding?.r ?? 0 })).sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0]
  const maxAll = Math.max(...measures.map(m => m.models.assumptions))
  const maxProfit = Math.max(...measures.flatMap(m => ['patient_margin', 'total_margin'].map(v => Math.abs(m.variables[v]?.r ?? 0))))
  const stateAdded = Math.max(...measures.map(m => m.groups.state.added))

  return (
    <section className="space-y-4">
      <SectionTitle step={1} title="What we expected to matter" />
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-700 space-y-2 leading-relaxed max-w-3xl">
        <p>
          <strong>Much less than we thought.</strong> Together, state conditions and profit margins explain at most{' '}
          {share(maxAll)} of the differences between hospitals on any measure, and close to nothing for most.
        </p>
        <p>
          <strong>Money shows {strengthOf(maxProfit)} link.</strong> No measure correlates with either profit margin by more
          than {maxProfit.toFixed(2)}.{maxProfit < 0.1 && ' Profitable and money-losing hospitals get about the same results.'}
        </p>
        <p>
          <strong>The strongest link is state crowding</strong>: hospitals in states with fuller beds have{' '}
          {crowd.r < 0 ? 'worse' : 'better'} {lower(crowd.m.category)} (r {formatR(crowd.r)}). But once we know a hospital's
          own size, type and patients, state conditions add at most {points(stateAdded)} of explanatory power.
          Hospitals differ far more within a state than states differ from each other.
        </p>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">Assumption</th>
              {measures.map(m => <th key={m.category} className="px-2 py-2 text-center">{labelOf(m.category)}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ASSUMPTIONS.map(v => (
              <tr key={v}>
                <td className="px-4 py-1.5 text-gray-700">{VARIABLE_LABELS[v].label}</td>
                {measures.map(m => <RCell key={m.category} r={m.variables[v]?.r ?? 0} n={m.variables[v]?.n ?? 0} />)}
              </tr>
            ))}
            <tr className="bg-gray-50">
              <td className="px-4 py-2 font-medium text-gray-800">All six together: share explained</td>
              {measures.map(m => (
                <td key={m.category} className="px-2 py-2 text-center tabular-nums font-medium text-gray-800">{share(m.models.assumptions)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Cells are correlations with each measure's actual scores: blue goes with better results, red with worse, gray is
        close to none (under ±0.07).
      </p>
    </section>
  )
}

function SearchSection({ measures }: { measures: MeasurePredictors[] }) {
  const [category, setCategory] = useState<Category>(measures[0].category)
  const m = measures.find(x => x.category === category) ?? measures[0]
  const groups = Object.entries(m.groups).sort((a, b) => b[1].alone - a[1].alone)
  const facts = Object.entries(m.variables)
    .filter(([v, s]) => v !== 'prior_score' && VARIABLE_LABELS[v] && s.coverage >= 0.4)
    .sort((a, b) => Math.abs(b[1].r) - Math.abs(a[1].r))
    .slice(0, 5)
  const maxModel = Math.max(...MODEL_STEPS.map(s => m.models[s.key]))

  return (
    <section className="space-y-4">
      <SectionTitle step={2} title="Searching for better predictors" />
      <p className="text-sm text-gray-600 max-w-3xl leading-relaxed">
        We then tried every group of public facts we could link to hospitals, one measure at a time, and asked how much
        each predicts alone and how much it still adds once everything else is known.
      </p>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Measure">
        {measures.map(x => (
          <button
            key={x.category}
            type="button"
            onClick={() => setCategory(x.category)}
            aria-pressed={x.category === category}
            className={`px-3 py-1.5 rounded-md text-sm ${x.category === category ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'}`}
          >
            {labelOf(x.category)}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Group of facts</th>
                <th className="px-4 py-2 text-left">Explains alone</th>
                <th className="px-4 py-2 text-right">Adds on top of everything else</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {groups.map(([g, s]) => (
                <tr key={g} className="align-top">
                  <td className="px-4 py-2">
                    <div className={`text-gray-800 ${g === 'track_record' ? 'font-semibold' : ''}`}>{GROUP_INFO[g]?.name ?? g}</div>
                    <div className="text-xs text-gray-500">{GROUP_INFO[g]?.description}</div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-28 h-2 rounded-full overflow-hidden shrink-0" style={{ backgroundColor: '#cde2fb' }} aria-hidden="true">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(1, s.alone * 100)}%`, backgroundColor: SERIES }} />
                      </div>
                      <span className="tabular-nums text-gray-800">{share(s.alone)}</span>
                    </div>
                  </td>
                  <td className={`px-4 py-2 text-right tabular-nums ${s.added >= 0.01 ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
                    {s.added >= 0.001 ? `+${points(s.added)}` : 'nothing'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm font-medium text-gray-800">Building up the model</p>
            <ol className="mt-3 space-y-3">
              {MODEL_STEPS.map(s => (
                <li key={s.key}>
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="text-gray-700">{s.label}</span>
                    <span className="tabular-nums font-medium text-gray-900">{share(m.models[s.key])}</span>
                  </div>
                  <div className="h-2 mt-1 rounded-full overflow-hidden" style={{ backgroundColor: '#cde2fb' }} aria-hidden="true">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(1, (m.models[s.key] / Math.max(maxModel, 0.01)) * 100)}%`, backgroundColor: SERIES }} />
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{s.help}</div>
                </li>
              ))}
            </ol>
            {m.noiseShare !== null && (
              <p className="text-xs text-gray-500 mt-3">
                About {share(m.noiseShare)} of the differences in {lower(m.category)} are measurement noise from small
                numbers of patients, which no model can predict.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <p className="text-sm font-medium text-gray-800">Strongest single facts for {lower(m.category)}</p>
        <ul className="mt-2 space-y-1 text-sm text-gray-700">
          {facts.map(([v, s]) => (
            <li key={v}>
              Hospitals with {VARIABLE_LABELS[v].more} tend to have{' '}
              <span className={s.r > 0 ? 'text-blue-800' : 'text-red-800'}>{s.r > 0 ? 'better' : 'worse'}</span>{' '}
              {lower(m.category)} <span className="text-gray-500 tabular-nums">(r {formatR(s.r)})</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500 mt-2">
          Many of these overlap: bigger hospitals are also busier, more urban and more often teaching hospitals, which is why
          a group can predict a lot alone and add little on top.
        </p>
      </div>
    </section>
  )
}

function PersistenceSection({ measures }: { measures: MeasurePredictors[] }) {
  const sorted = [...measures].sort((a, b) => b.groups.track_record.added - a.groups.track_record.added)
  const raw = measures.filter(m => m.noiseShare !== null)
  const smoothed = measures.filter(m => m.noiseShare === null)
  const oldest = (m: MeasurePredictors) => m.persistence.find(p => !p.overlapping)
  const separate = (m: MeasurePredictors) => m.persistence.filter(p => !p.overlapping)
  const yearsAgo = Math.round(Math.max(...raw.map(m => oldest(m)?.yearsBack ?? 0)))
  const span = (rs: number[]) => `${Math.min(...rs).toFixed(2)}–${Math.max(...rs).toFixed(2)}`
  // Measures whose link holds steady from the most recent separate period to the oldest.
  const steady = smoothed.filter(m => {
    const sep = separate(m)
    return sep.length > 1 && sep[sep.length - 1].r - sep[0].r < 0.08
  })

  return (
    <section className="space-y-4">
      <SectionTitle step={3} title="The best predictor: a hospital's own past" />
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-700 space-y-2 leading-relaxed max-w-3xl">
        <p>
          <strong>Nothing we found predicts a hospital's results as well as its own earlier results.</strong> Adding the
          earlier score on top of every other fact raises the share explained by{' '}
          {sorted.map((m, i) => (
            <span key={m.category}>
              {i > 0 && (i === sorted.length - 1 ? ' and ' : ', ')}
              {points(m.groups.track_record.added)} for {lower(m.category)}
            </span>
          ))}
          .
        </p>
        <p>
          <strong>Track records last.</strong> {capitalize(list(raw.map(m => lower(m.category))))} from about {yearsAgo}{' '}
          years ago still correlate {span(raw.map(m => oldest(m)?.r ?? 0))} with today's.{' '}
          {capitalize(list(smoothed.map(m => lower(m.category))))} correlate only{' '}
          {span(smoothed.flatMap(m => separate(m).map(p => p.r)))} across separate periods, because those scores are much
          noisier.
          {steady.length > 0 && ` Still, for ${list(steady.map(m => lower(m.category)))} the link barely fades with time: the part that isn't noise is lasting.`}
        </p>
        <p>
          That points to something stable about each hospital that public data doesn't capture, such as how it is run,
          its processes and its culture. We can see that it persists, but not what it is.
        </p>
        <p>
          Some hospitals do break from their past. See{' '}
          <a href={href('movers')} className="text-blue-600 hover:underline">who really changed</a>, and whether anything
          predicted it.
        </p>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-700">Correlation between each earlier period's scores and the current period's</p>
          <PersistenceLegend />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mt-3">
          {measures.map(m => <PersistenceChart key={m.category} label={labelOf(m.category)} points={m.persistence} />)}
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-blue-600 text-xs">Show as a table</summary>
          <table className="w-full mt-2 tabular-nums">
            <thead className="text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="py-1 text-left">Measure</th>
                <th className="py-1 text-left">Earlier period</th>
                <th className="py-1 text-right">Years before</th>
                <th className="py-1 text-right">Correlation</th>
                <th className="py-1 text-right">Hospitals</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {measures.flatMap(m => m.persistence.map(p => (
                <tr key={`${m.category}-${p.periodEnd}`}>
                  <td className="py-1">{labelOf(m.category)}</td>
                  <td className="py-1">
                    {p.periodStart ? `${formatMonth(p.periodStart)} – ` : ''}{formatMonth(p.periodEnd)}
                    {p.overlapping && <span className="text-gray-400"> (overlaps)</span>}
                  </td>
                  <td className="py-1 text-right">{p.yearsBack.toFixed(1)}</td>
                  <td className="py-1 text-right">{formatR(p.r)}</td>
                  <td className="py-1 text-right">{p.n.toLocaleString('en-US')}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  )
}

function PersistenceLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600" aria-hidden="true">
      <span className="inline-flex items-center gap-1.5">
        <svg width="12" height="12"><circle cx="6" cy="6" r="4" fill={SERIES} stroke={SURFACE} strokeWidth="2" /></svg>
        Separate period
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="12" height="12"><circle cx="6" cy="6" r="3.5" fill={SURFACE} stroke={SERIES} strokeWidth="1.5" /></svg>
        Overlaps the current period (shares patients)
      </span>
    </div>
  )
}

// Small multiple: r (0-1) by how many years before the current period each
// earlier period ended, oldest on the left. Drawn at measured pixel width.
function PersistenceChart({ label, points: pts }: { label: string; points: PersistencePoint[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(170)
  const [active, setActive] = useState<number | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setW(Math.max(140, Math.round(entry.contentRect.width))))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  const H = 120
  const M = { top: 8, right: 10, bottom: 20, left: 26 }
  const maxYears = Math.max(7, ...pts.map(p => Math.ceil(p.yearsBack - 0.05)))
  const sx = (years: number) => M.left + (1 - years / maxYears) * (W - M.left - M.right)
  const sy = (r: number) => H - M.bottom - Math.max(0, Math.min(1, r)) * (H - M.top - M.bottom)
  const separate = pts.filter(p => !p.overlapping)
  const line = separate.map((p, k) => `${k ? 'L' : 'M'}${sx(p.yearsBack).toFixed(1)},${sy(p.r).toFixed(1)}`).join('')
  const shown = active === null ? null : pts[active]
  const summary = `${label}: correlation ${separate.map(p => `${formatR(p.r)} at ${p.yearsBack.toFixed(1)} years`).join(', ')}`

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const i = active ?? pts.length - 1
    setActive(Math.min(pts.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1))))
  }

  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-gray-700">{label}</div>
      <div
        ref={ref}
        className="relative mt-1 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        tabIndex={0}
        role="img"
        aria-label={summary}
        onKeyDown={onKey}
        onFocus={() => setActive(pts.length - 1)}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
      >
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" aria-hidden="true">
          {[0, 0.5, 1].map(t => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke={t === 0 ? '#d1d5db' : '#f0f1f3'} />
              <text x={M.left - 6} y={sy(t) + 3} fontSize="10" fill="#6b7280" textAnchor="end">{t.toFixed(1)}</text>
            </g>
          ))}
          <text x={M.left} y={H - 4} fontSize="10" fill="#6b7280">{maxYears} yrs ago</text>
          <text x={W - M.right} y={H - 4} fontSize="10" fill="#6b7280" textAnchor="end">now</text>
          <path d={line} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" />
          {pts.map((p, i) => (
            <circle
              key={p.periodEnd}
              cx={sx(p.yearsBack)} cy={sy(p.r)} r={active === i ? 5 : 4}
              fill={p.overlapping ? SURFACE : SERIES} stroke={p.overlapping ? SERIES : SURFACE} strokeWidth={p.overlapping ? 1.5 : 2}
            />
          ))}
          {pts.map((p, i) => (
            <rect key={`hit-${p.periodEnd}`} x={sx(p.yearsBack) - 10} y={0} width={20} height={H} fill="transparent" onMouseEnter={() => setActive(i)} />
          ))}
        </svg>
        {shown && (
          <div
            className="pointer-events-none absolute z-10 -top-2 -translate-y-full rounded border border-gray-200 bg-white px-2 py-1 text-[11px] leading-snug shadow-sm whitespace-nowrap"
            style={{ left: Math.min(Math.max(sx(shown.yearsBack) - 70, 0), Math.max(0, W - 150)) }}
          >
            <div className="text-gray-500">
              {shown.periodStart ? `${formatMonth(shown.periodStart)} – ` : ''}{formatMonth(shown.periodEnd)}
              {shown.overlapping ? ' (overlaps)' : ''}
            </div>
            <div className="text-gray-900">Correlation with today: {formatR(shown.r)}</div>
            <div className="text-gray-500">{shown.n.toLocaleString('en-US')} hospitals</div>
          </div>
        )}
      </div>
    </div>
  )
}

function OneThingSection({ measures, correlations }: { measures: MeasurePredictors[]; correlations: PredictorsOverview['correlations'] }) {
  const byId = new Map(measures.map(m => [m.measureId, m]))
  const pair = (a: MeasurePredictors, b: MeasurePredictors) =>
    correlations.find(c => (c.a === a.measureId && c.b === b.measureId) || (c.a === b.measureId && c.b === a.measureId))
  const sorted = [...correlations].sort((a, b) => b.r - a.r)
  const top = sorted[0]
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)].r : 0

  return (
    <section className="space-y-4">
      <SectionTitle step={4} title="Is quality one thing?" />
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-700 space-y-2 leading-relaxed max-w-3xl">
        <p>
          <strong>Not really.</strong> If some hospitals were simply "good", they'd be good at everything. Instead, scores on
          different measures barely go together: the typical correlation between two measures is {formatR(median)}.
          {top && byId.get(top.a) && byId.get(top.b) && (
            <>
              {' '}The closest pair is {lower(byId.get(top.a)!.category)} and {lower(byId.get(top.b)!.category)} ({formatR(top.r)})
              {[byId.get(top.a)!.category, byId.get(top.b)!.category].sort().join() === 'satisfaction,wait_times' &&
                ", both part of the patient's experience of getting care"}
              .
            </>
          )}
        </p>
        <p>
          So a hospital's own past on the <em>same</em> measure tells you far more than its results on other measures. That
          is one reason the overall score on the expected-vs-actual page averages several measures instead of trusting one.
        </p>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto max-w-3xl">
        <table className="text-sm">
          <thead className="text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2" />
              {measures.map(m => <th key={m.category} className="px-2 py-2 text-center">{labelOf(m.category)}</th>)}
            </tr>
          </thead>
          <tbody>
            {measures.map(a => (
              <tr key={a.category}>
                <th className="px-4 py-1 text-left font-normal text-gray-700 whitespace-nowrap">{labelOf(a.category)}</th>
                {measures.map(b => {
                  if (a === b) return <td key={b.category} className="px-1 py-1"><div className="px-2 py-1.5 text-center text-xs text-gray-300">—</div></td>
                  const c = pair(a, b)
                  return c ? <RCell key={b.category} r={c.r} n={c.n} /> : <td key={b.category} />
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-500 px-4 pb-3">
          Correlations between hospitals' current scores on two measures, over hospitals with both; positive means good on one
          goes with good on the other.
        </p>
      </div>
    </section>
  )
}

function TakeawaysSection({ measures }: { measures: MeasurePredictors[] }) {
  const ops = measures.filter(m => m.noiseShare !== null)
  const clinical = measures.filter(m => m.noiseShare === null)
  const range = (ms: MeasurePredictors[], f: (m: MeasurePredictors) => number) =>
    `${share(Math.min(...ms.map(f)))}–${share(Math.max(...ms.map(f)))}`

  return (
    <section className="space-y-3">
      <SectionTitle step={5} title="What we learned" />
      <ol className="list-decimal pl-5 text-sm text-gray-700 space-y-2 leading-relaxed max-w-3xl">
        <li>
          <strong>Our starting assumptions were mostly wrong.</strong> State strain, state spending and hospital profits
          explain little, and add almost nothing once you know the hospital itself.
        </li>
        <li>
          <strong>What kind of hospital it is matters for the patient experience</strong>, not much for clinical outcomes.
          Facts about the hospital (its size, type, patients, community, finances and staffing) explain{' '}
          {range(ops, m => m.models.everything_known)} of the differences in {list(ops.map(m => lower(m.category)))}, but
          only {range(clinical, m => m.models.everything_known)} for {list(clinical.map(m => lower(m.category)))}.
        </li>
        <li>
          <strong>The best predictor is the hospital's own track record</strong>, and it lasts for years. Whatever makes a
          hospital good or bad is stable, and largely invisible in public data.
        </li>
        <li>
          <strong>Quality isn't one thing.</strong> Being good at one measure says little about the others.
        </li>
      </ol>
    </section>
  )
}
