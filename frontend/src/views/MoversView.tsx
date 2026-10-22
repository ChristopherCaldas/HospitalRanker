import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import type { Category, MeasureMovers, Mover } from '../types'
import { CATEGORIES, formatMonth, formatValue } from '../lib/format'
import { CHANGE_GROUP_INFO, formatChange } from '../lib/movers'
import { sequentialColor, textOn } from '../lib/colors'
import { href } from '../lib/router'
import TabNav from '../components/TabNav'
import HowToRead from '../components/HowToRead'
import TrendChart, { TrendLegend } from '../components/TrendChart'

const SERIES = '#2a78d6'
const SURFACE = '#ffffff'
const FIFTH_NAMES = ['Worst fifth', 'Second', 'Middle', 'Fourth', 'Best fifth']

const labelOf = (c: Category) => CATEGORIES.find(x => x.id === c)?.label ?? c
const lower = (c: Category) => labelOf(c).toLowerCase().replace(/^er /, 'ER ')
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`
const year = (iso: string) => iso.slice(0, 4)
const share = (v: number) => (v > 0 && v < 0.001 ? 'under 0.1%' : pct(v, 1))
const signed = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`
// Change by starting fifth relative to the average hospital's change, so a
// shift that hit everyone (e.g. a national rise in readmissions) drops out
// and what's left is the pull toward the middle.
export function relativeFifths(m: MeasureMovers) {
  const n = m.fifths.reduce((s, f) => s + f.hospitals, 0)
  const mean = m.fifths.reduce((s, f) => s + f.avgChange * f.hospitals, 0) / Math.max(1, n)
  return m.fifths.map(f => ({ ...f, avgChange: f.avgChange - mean }))
}
const order = (ms: MeasureMovers[]) =>
  CATEGORIES.map(c => ms.find(m => m.category === c.id)).filter((m): m is MeasureMovers => !!m)

export default function MoversView({ category }: { category: Category }) {
  const [data, setData] = useState<MeasureMovers[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    axios.get<MeasureMovers[]>('/api/movers').then(res => setData(res.data)).catch(() => setError(true))
  }, [])

  if (error) return <p className="text-center text-red-500 py-16">Couldn't load the movers analysis.</p>
  if (!data) return <p className="text-center text-gray-400 py-16">Loading…</p>
  if (data.length === 0) return <p className="text-center text-gray-400 py-16">No movers analysis yet.</p>
  return <MoversReport data={data} category={category} />
}

// The page body, separate from loading so it can be rendered from fixtures.
export function MoversReport({ data, category }: { data: MeasureMovers[]; category: Category }) {
  const measures = order(data)
  const compared = measures.reduce((s, m) => s + m.hospitals, 0)
  const changed = measures.reduce((s, m) => s + m.improved + m.declined, 0)
  const worstGain = (m: MeasureMovers) => relativeFifths(m)[0].avgChange
  const rtm = [...measures].sort((a, b) => worstGain(b) / b.tau - worstGain(a) / a.tau)[0]
  const bestPredicted = [...measures].sort((a, b) => b.predictors.everything - a.predictors.everything)[0]
  const owners = Math.max(...measures.map(m => m.ownership.hospitals))
  const ownersClear = measures.filter(m => Math.abs(m.ownership.effect) > 1.96 * m.ownership.se && m.ownership.se > 0)

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-10">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">Who really changed?</h2>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed max-w-3xl">
          A hospital's own track record is the best predictor of its results (see{' '}
          <a href={href('predictors')} className="text-blue-600 hover:underline">what predicts results</a>). So when a
          hospital does change, that's news. This page compares each hospital's latest scores with its scores about three
          years earlier, separates real change from luck, names the hospitals that clearly got better or worse, and asks
          whether anything could have predicted it.
        </p>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat value={share(changed / compared)} label="of hospital scores clearly changed, across the five measures" />
        <Stat
          value={formatChange(worstGain(rtm), rtm.unit).replace(/ (better|worse)$/, '')}
          label={`how much more the worst fifth "improved" on ${lower(rtm.category)} than the average hospital, mostly regression to the mean`}
        />
        <Stat value={pct(Math.max(0, bestPredicted.predictors.everything))} label="the most of any measure's changes we could predict" />
        <Stat
          value={owners.toLocaleString('en-US')}
          label={ownersClear.length ? 'hospitals changed owners; see the effect below' : 'hospitals changed owners, with no clear effect on any measure'}
        />
      </section>

      <RegressionSection measures={measures} />
      <RaritySection measures={measures} />
      <WhoSection measures={measures} category={category} />
      <PredictSection measures={measures} />
      <TakeawaysSection measures={measures} />

      <HowToRead
        items={[
          {
            term: 'Regression to the mean',
            text: "A score is part skill, part luck. The hospitals that look worst in one period are, on average, partly unlucky, so next time they tend to look better without changing anything (and the best tend to look worse). We measure each hospital's change against what that pull alone predicts from its starting score.",
          },
          {
            term: 'Clearly improved / declined',
            text: "We're 95% sure the hospital changed by more than the typical real change between hospitals, after allowing for luck and regression to the mean. The same \"clear cases only\" rule as the expected-vs-actual page.",
          },
          {
            term: 'Detectable change',
            text: "A looser bar: 95% sure the change isn't zero, however small.",
          },
          {
            term: 'Periods compared',
            text: "The latest period against the latest earlier one that shares no months with it and ended at least two and a half years before it, so the two don't count the same patients.",
          },
          {
            term: 'Predicting change',
            text: "Share of the differences in change between hospitals explained (cross-validated R², as on the predictors page), using cost reports from the start and end of the comparison and CMS's change-of-ownership records.",
          },
        ]}
      />
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

function RegressionSection({ measures }: { measures: MeasureMovers[] }) {
  // Measures where the worst fifth "improved" and the best fifth "declined" relative to everyone else.
  const pulled = measures.filter(m => {
    const f = relativeFifths(m)
    return f[0].avgChange > 0 && f[4].avgChange < 0
  })
  return (
    <section className="space-y-4">
      <SectionTitle step={1} title="The trap: regression to the mean" />
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-700 space-y-2 leading-relaxed max-w-3xl">
        <p>
          <strong>Raw before-and-after comparisons overstate change.</strong> Split hospitals into fifths by their earlier
          score: on {list(pulled.map(m => lower(m.category)))}, the worst fifth "improved" more than the average hospital
          and the best fifth "got worse". Some of that is real, but most is luck evening out. A hospital that had an unlucky year
          looks like a turnaround story the next time.
        </p>
        <p>
          That is why a hospital's change is measured against what this pull alone predicts from its starting score,
          not against zero.
        </p>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <p className="text-sm text-gray-700">
          Average change by fifth of the earlier score, compared with the average hospital's change (above the line = did
          better than average)
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mt-3">
          {measures.map(m => <FifthsChart key={m.category} m={m} />)}
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-blue-600 text-xs">Show as a table</summary>
          <table className="w-full mt-2 tabular-nums">
            <thead className="text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="py-1 text-left">Measure</th>
                {FIFTH_NAMES.map(f => <th key={f} className="py-1 text-right">{f}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {measures.map(m => (
                <tr key={m.category}>
                  <td className="py-1">{labelOf(m.category)}</td>
                  {relativeFifths(m).map(f => <td key={f.fifth} className="py-1 text-right">{formatChange(f.avgChange, m.unit)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </section>
  )
}

// Small multiple: average oriented change per starting fifth, with 95% range,
// around a zero line. Drawn at measured pixel width.
function FifthsChart({ m }: { m: MeasureMovers }) {
  const fifths = relativeFifths(m)
  const ref = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(170)
  const [active, setActive] = useState<number | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setW(Math.max(140, Math.round(entry.contentRect.width))))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  const H = 130
  const M = { top: 10, right: 6, bottom: 22, left: 6 }
  const ext = Math.max(...fifths.map(f => Math.abs(f.avgChange) + 1.96 * f.se), 1e-6) * 1.15
  const sx = (i: number) => M.left + ((i + 0.5) / 5) * (W - M.left - M.right)
  const sy = (v: number) => M.top + ((ext - v) / (2 * ext)) * (H - M.top - M.bottom)
  const shown = active === null ? null : fifths[active]

  return (
    <div className="min-w-0">
      <div className="text-xs font-medium text-gray-700">{labelOf(m.category)}</div>
      <div className="text-[11px] text-gray-400">{year(m.from.end)} → {year(m.to.end)}</div>
      <div ref={ref} className="relative mt-1" onMouseLeave={() => setActive(null)}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img"
          aria-label={`${labelOf(m.category)}: change by starting fifth vs. the average hospital, ${fifths.map(f => formatChange(f.avgChange, m.unit)).join(', ')}`}>
          <line x1={M.left} x2={W - M.right} y1={sy(0)} y2={sy(0)} stroke="#9ca3af" />
          {fifths.map((f, i) => (
            <g key={f.fifth}>
              <line x1={sx(i)} x2={sx(i)} y1={sy(f.avgChange - 1.96 * f.se)} y2={sy(f.avgChange + 1.96 * f.se)} stroke={SERIES} strokeWidth={2} />
              <circle cx={sx(i)} cy={sy(f.avgChange)} r={active === i ? 5 : 4} fill={SERIES} stroke={SURFACE} strokeWidth={2} />
              <rect
                x={sx(i) - (W - M.left - M.right) / 10} y={0} width={(W - M.left - M.right) / 5} height={H} fill="transparent"
                tabIndex={0} aria-label={`${FIFTH_NAMES[i]}: ${formatChange(f.avgChange, m.unit)}`}
                onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
              />
            </g>
          ))}
          <text x={sx(0)} y={H - 6} fontSize="10" fill="#6b7280" textAnchor="middle">worst</text>
          <text x={sx(4)} y={H - 6} fontSize="10" fill="#6b7280" textAnchor="middle">best</text>
        </svg>
        {shown && (
          <div
            className="pointer-events-none absolute z-10 -top-2 -translate-y-full rounded border border-gray-200 bg-white px-2 py-1 text-[11px] leading-snug shadow-sm whitespace-nowrap"
            style={{ left: Math.min(Math.max(sx(active!) - 70, 0), Math.max(0, W - 150)) }}
          >
            <div className="text-gray-500">{FIFTH_NAMES[active!]} in {year(m.from.end)}</div>
            <div className="text-gray-900">vs. average hospital: {formatChange(shown.avgChange, m.unit)}</div>
            <div className="text-gray-500">{shown.hospitals.toLocaleString('en-US')} hospitals</div>
          </div>
        )}
      </div>
    </div>
  )
}

function RaritySection({ measures }: { measures: MeasureMovers[] }) {
  const rate = (m: MeasureMovers) => (m.improved + m.declined) / m.hospitals
  const sorted = [...measures].sort((a, b) => rate(a) - rate(b))
  const declineHeavy = measures.filter(m => m.declined > 2 * Math.max(1, m.improved))
  return (
    <section className="space-y-4">
      <SectionTitle step={2} title="How rare real change is" />
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-700 space-y-2 leading-relaxed max-w-3xl">
        <p>
          <strong>Very.</strong> In about three years, at most {share(rate(sorted[sorted.length - 1]))} of hospitals clearly
          changed on any one measure ({lower(sorted[sorted.length - 1].category)}), and as few as {share(rate(sorted[0]))}{' '}
          ({lower(sorted[0].category)}). Many more show <em>some</em> detectable change, but a small one.
        </p>
        {declineHeavy.length > 0 && (
          <p>
            When hospitals do change clearly, it's more often for the worse on {list(declineHeavy.map(m => lower(m.category)))}.
          </p>
        )}
      </div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">Measure</th>
              <th className="px-4 py-2 text-left">Compared</th>
              <th className="px-4 py-2 text-right" title="Raw scores: from the bottom fifth to the top fifth, or the reverse">Raw jumps between extremes</th>
              <th className="px-4 py-2 text-right">Detectable change</th>
              <th className="px-4 py-2 text-right">Clearly improved</th>
              <th className="px-4 py-2 text-right">Clearly declined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 tabular-nums">
            {measures.map(m => (
              <tr key={m.category}>
                <td className="px-4 py-2 text-gray-800">{labelOf(m.category)}</td>
                <td className="px-4 py-2 text-gray-600">
                  {formatMonth(m.from.start)} – {formatMonth(m.from.end)} vs. {formatMonth(m.to.start)} – {formatMonth(m.to.end)}
                  <div className="text-xs text-gray-400">{m.hospitals.toLocaleString('en-US')} hospitals</div>
                </td>
                <td className="px-4 py-2 text-right">{(m.rawJumps + m.rawDrops).toLocaleString('en-US')}</td>
                <td className="px-4 py-2 text-right">{pct(m.detectable / m.hospitals)}</td>
                <td className="px-4 py-2 text-right text-green-800">{m.improved}</td>
                <td className="px-4 py-2 text-right text-red-800">{m.declined}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function WhoSection({ measures, category }: { measures: MeasureMovers[]; category: Category }) {
  const m = measures.find(x => x.category === category) ?? measures[0]
  const improved = m.movers.filter(x => x.verdict === 'improved')
  const declined = m.movers.filter(x => x.verdict === 'declined')
  return (
    <section className="space-y-4" id="who">
      <SectionTitle step={3} title="Who changed" />
      <p className="text-sm text-gray-600 max-w-3xl">
        Hospitals that clearly improved or declined on {lower(m.category)} from the period ending{' '}
        {formatMonth(m.from.end)} to the one ending {formatMonth(m.to.end)}, most certain first. Each trend shows every period on record, so you can see whether the
        change was steady or a single jump.
      </p>
      <div className="-mx-6">
        <TabNav categories={measures.map(x => ({ id: x.category, label: labelOf(x.category) }))} active={m.category} hrefFor={c => href('movers', c)} />
      </div>
      <TrendLegend />
      <div className="grid gap-6 md:grid-cols-2">
        <MoverList title="Clearly improved" movers={improved} m={m} />
        <MoverList title="Clearly declined" movers={declined} m={m} />
      </div>
    </section>
  )
}

const SHOW = 4

function MoverList({ title, movers, m }: { title: string; movers: Mover[]; m: MeasureMovers }) {
  const [all, setAll] = useState(false)
  if (movers.length === 0) {
    return (
      <div>
        <h4 className="font-semibold text-gray-800">{title}</h4>
        <p className="text-sm text-gray-500 mt-2">None on this measure.</p>
      </div>
    )
  }
  const rest = movers.slice(SHOW)
  return (
    <div>
      <h4 className="font-semibold text-gray-800">{title} <span className="text-gray-400 font-normal">({movers.length})</span></h4>
      <ul className="mt-2 space-y-3">
        {movers.slice(0, SHOW).map(x => (
          <li key={x.facilityId} className="bg-white border border-gray-200 rounded-lg p-3">
            <MoverHeader x={x} m={m} />
            <div className="mt-2">
              <TrendChart label="Trend" points={x.history} unit={m.unit} higherIsBetter={m.higherIsBetter} />
            </div>
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setAll(!all)} className="text-xs text-blue-600 hover:underline" aria-expanded={all}>
            {all ? 'Show fewer' : `Show ${rest.length} more`}
          </button>
          {all && (
            <ul className="mt-2 divide-y divide-gray-100 bg-white border border-gray-200 rounded-lg">
              {rest.map(x => <li key={x.facilityId} className="px-3 py-2"><MoverHeader x={x} m={m} /></li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function MoverHeader({ x, m }: { x: Mover; m: MeasureMovers }) {
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <a href={href('hospitals', x.facilityId)} className="font-medium text-blue-700 hover:underline">{x.name}</a>
        <span className="text-xs text-gray-500">{[x.city, x.state].filter(Boolean).join(', ')}</span>
      </div>
      <div className="text-xs text-gray-600 mt-0.5 tabular-nums">
        {formatValue(x.startScore, m.unit)} → {formatValue(x.endScore, m.unit)}
        <span className="text-gray-400"> (expected {formatValue(x.expectedEnd, m.unit)} from regression to the mean)</span>
        {' · '}
        <span className={x.verdict === 'improved' ? 'text-green-800' : 'text-red-800'}>{formatChange(x.change, m.unit)}</span>
        {x.ownershipChange && <span className="ml-1 px-1 py-0.5 rounded border border-gray-200 text-gray-600">changed owners</span>}
      </div>
    </div>
  )
}

// Share-explained cell: sequential blue by size (0 to 10%+), value printed.
function ShareCell({ v }: { v: number }) {
  const fill = sequentialColor(Math.min(0.1, Math.max(0, v)), 0, 0.1)
  return (
    <td className="px-1 py-1">
      <div className="rounded px-2 py-1.5 text-center tabular-nums text-xs" style={{ backgroundColor: fill, color: textOn(fill) }}>
        {pct(Math.max(0, v))}
      </div>
    </td>
  )
}

function PredictSection({ measures }: { measures: MeasureMovers[] }) {
  const groups = Object.keys(CHANGE_GROUP_INFO)
  const maxAll = Math.max(...measures.map(m => m.predictors.everything))
  const ownership = measures.filter(m => m.ownership.se > 0)
  const clear = ownership.filter(m => Math.abs(m.ownership.effect) > 1.96 * m.ownership.se)
  const span = ownership.length
    ? `${signed(Math.min(...ownership.map(m => m.ownership.effect - 1.96 * m.ownership.se)))} to ${signed(Math.max(...ownership.map(m => m.ownership.effect + 1.96 * m.ownership.se)))}`
    : ''

  return (
    <section className="space-y-4">
      <SectionTitle step={4} title="Could anyone have seen it coming?" />
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-700 space-y-2 leading-relaxed max-w-3xl">
        <p>
          <strong>Mostly not.</strong> Everything we know about hospitals' finances, staffing and size, at the start and
          how it changed, plus whether they changed owners, explains at most {pct(Math.max(0, maxAll))} of who improved
          and who declined on any measure.
        </p>
        {ownership.length > 0 && (
          <p>
            <strong>Changing owners</strong> {clear.length === 0
              ? `made no clear difference on any measure: the effect is within ${span} typical changes either way, and in each case the range includes zero.`
              : `went with a clear difference on ${list(clear.map(m => lower(m.category)))}.`}
          </p>
        )}
        <p>
          The causes of real change, such as new leadership, a new ER layout or losing key staff, don't show up in the
          public data at the hospital level.
        </p>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">Facts used to predict change</th>
              {measures.map(m => <th key={m.category} className="px-2 py-2 text-center">{labelOf(m.category)}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {groups.map(g => (
              <tr key={g}>
                <td className="px-4 py-1.5">
                  <div className="text-gray-800">{CHANGE_GROUP_INFO[g].name}</div>
                  <div className="text-xs text-gray-500">{CHANGE_GROUP_INFO[g].description}</div>
                </td>
                {measures.map(m => <ShareCell key={m.category} v={m.predictors.groups[g]?.alone ?? 0} />)}
              </tr>
            ))}
            <tr className="bg-gray-50">
              <td className="px-4 py-2 font-medium text-gray-800">All of them together</td>
              {measures.map(m => (
                <td key={m.category} className="px-2 py-2 text-center tabular-nums font-medium text-gray-800">{pct(Math.max(0, m.predictors.everything))}</td>
              ))}
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-gray-500 px-4 py-2">Share of the differences in change between hospitals each set of facts predicts.</p>
      </div>
      {ownership.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-700">Change of ownership: how much more (or less) the hospitals that changed owners changed</p>
          <p className="text-xs text-gray-500 mt-1">In typical real changes; dot = estimate, line = 95% range, compared with hospitals of the same type and ownership.</p>
          <EffectChart measures={ownership} />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-blue-600 text-xs">Show as a table</summary>
            <table className="w-full mt-2 tabular-nums">
              <thead className="text-gray-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="py-1 text-left">Measure</th>
                  <th className="py-1 text-right">Changed owners</th>
                  <th className="py-1 text-right">Effect</th>
                  <th className="py-1 text-right">Clearly improved / declined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ownership.map(m => (
                  <tr key={m.category}>
                    <td className="py-1">{labelOf(m.category)}</td>
                    <td className="py-1 text-right">{m.ownership.hospitals}</td>
                    <td className="py-1 text-right">{m.ownership.effect >= 0 ? '+' : '−'}{Math.abs(m.ownership.effect).toFixed(2)} ±{(1.96 * m.ownership.se).toFixed(2)}</td>
                    <td className="py-1 text-right">{m.ownership.improved} / {m.ownership.declined}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </section>
  )
}

// Horizontal dot-and-whisker: one row per measure, zero line in the middle.
function EffectChart({ measures }: { measures: MeasureMovers[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const row = 30
  const M = { top: 8, right: 16, bottom: 24, left: 120 }
  const H = M.top + M.bottom + row * measures.length
  const ext = Math.max(0.5, ...measures.map(m => Math.abs(m.ownership.effect) + 1.96 * m.ownership.se)) * 1.1
  const sx = (v: number) => M.left + ((v + ext) / (2 * ext)) * (W - M.left - M.right)
  return (
    <div ref={ref} className="mt-3">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img"
        aria-label={`Effect of a change of ownership: ${measures.map(m => `${labelOf(m.category)} ${m.ownership.effect.toFixed(2)}`).join(', ')}`}>
        <line x1={sx(0)} x2={sx(0)} y1={M.top} y2={H - M.bottom} stroke="#9ca3af" />
        {measures.map((m, i) => {
          const y = M.top + row * i + row / 2
          const lo = m.ownership.effect - 1.96 * m.ownership.se
          const hi = m.ownership.effect + 1.96 * m.ownership.se
          return (
            <g key={m.category}>
              <text x={M.left - 8} y={y + 4} fontSize="11" fill="#374151" textAnchor="end">{labelOf(m.category)}</text>
              <line x1={sx(lo)} x2={sx(hi)} y1={y} y2={y} stroke={SERIES} strokeWidth={2} />
              <circle cx={sx(m.ownership.effect)} cy={y} r={5} fill={SERIES} stroke={SURFACE} strokeWidth={2}>
                <title>{`${labelOf(m.category)}: ${m.ownership.effect.toFixed(2)} (95% range ${lo.toFixed(2)} to ${hi.toFixed(2)}), ${m.ownership.hospitals} hospitals`}</title>
              </circle>
            </g>
          )
        })}
        <text x={sx(-ext)} y={H - 6} fontSize="10" fill="#6b7280">← changed for the worse</text>
        <text x={sx(ext)} y={H - 6} fontSize="10" fill="#6b7280" textAnchor="end">changed for the better →</text>
      </svg>
    </div>
  )
}

function TakeawaysSection({ measures }: { measures: MeasureMovers[] }) {
  const maxAll = Math.max(...measures.map(m => m.predictors.everything))
  return (
    <section className="space-y-3">
      <SectionTitle step={5} title="What we learned" />
      <ol className="list-decimal pl-5 text-sm text-gray-700 space-y-2 leading-relaxed max-w-3xl">
        <li>
          <strong>Most "turnarounds" are luck.</strong> The worst hospitals drift toward the middle on their own; a fair
          comparison has to expect that.
        </li>
        <li>
          <strong>Real change is rare</strong>, a few percent of hospitals per measure over about three years, which is
          why track records predict so well.
        </li>
        <li>
          <strong>It's close to unpredictable from public data.</strong> Finances, staffing, size and ownership changes
          explain at most {pct(Math.max(0, maxAll))} of it.
        </li>
        <li>
          <strong>So the hospitals that changed are worth a closer look one by one</strong>: whatever happened there
          isn't in the spreadsheets.
        </li>
      </ol>
    </section>
  )
}
