import { useEffect, useState } from 'react'
import axios from 'axios'
import type { EquityFifth, EquityOverview, MoneyMetric, Scope } from '../types'
import { FIFTH_LABELS, MONEY_LABELS, SCOPE_INFO, formatMoney, pctRange, strengthOf } from '../lib/quality'
import { formatScore } from '../lib/performance'
import { href } from '../lib/router'
import DotChart from '../components/DotChart'
import HowToRead from '../components/HowToRead'

const RAW = '#eb6834'
const ADJUSTED = '#2a78d6'
const SCOPES: Scope[] = ['overall', 'outcome', 'process', 'mortality', 'safety', 'readmission', 'experience', 'timely_effective']
const MONEY: MoneyMetric[] = ['total_margin', 'patient_margin', 'uncompensated', 'other_income', 'cost_per_discharge', 'fte_per_bed', 'salary_per_fte', 'contract_labor']

export default function EquityView() {
  const [data, setData] = useState<EquityOverview | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    axios.get<EquityOverview>('/api/quality/equity').then(res => setData(res.data)).catch(() => setError(true))
  }, [])
  if (error) return <p className="text-center text-red-500 py-16">Couldn't load the equity analysis.</p>
  if (!data) return <p className="text-center text-gray-400 py-16">Loading…</p>
  return <EquityReport fifths={data.fifths} />
}

// Difference between the poorest and the richest fifth (+ = poorest does better).
const spread = (fifths: EquityFifth[], pick: (f: EquityFifth) => number | null) => {
  const a = pick(fifths[fifths.length - 1])
  const b = pick(fifths[0])
  return a === null || b === null ? null : a - b
}

export function EquityReport({ fifths }: { fifths: EquityFifth[] }) {
  const [scope, setScope] = useState<Scope>('overall')
  const total = fifths.reduce((a, f) => a + f.hospitals, 0)
  const richest = fifths[0]
  const poorest = fifths[fifths.length - 1]
  const gaps = SCOPES.map(s => ({
    scope: s,
    raw: spread(fifths, f => f.scores[s]?.raw ?? null),
    adjusted: spread(fifths, f => f.scores[s]?.adjusted ?? null),
  }))
  const overall = gaps[0]
  // Scopes where the adjustment turns an advantage for the poorest fifth into a deficit, or the reverse.
  const flipped = gaps.filter(g => g.raw !== null && g.adjusted !== null && Math.sign(g.raw) !== Math.sign(g.adjusted) && Math.abs(g.adjusted) >= 0.1)
  const withinAvg = MONEY.map(m => {
    const vals = fifths.map(f => f.within[m]?.spearman).filter((v): v is number => v !== null && v !== undefined)
    return { metric: m, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null }
  }).sort((a, b) => Math.abs(b.avg ?? 0) - Math.abs(a.avg ?? 0))
  const margin = (f: EquityFifth) => f.money.total_margin?.median ?? null

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-10">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">Rich patients, poor patients</h2>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed max-w-3xl">
          Equity is one of Donabedian's <a href={href('framework')} className="text-blue-600 hover:underline">seven pillars of quality</a>: care
          and its benefits should reach everyone fairly. This page splits hospitals into five equal groups by how many
          of their Medicare patients are poor enough to also qualify for Medicaid ("dual-eligible"), from{' '}
          {pctRange(richest.dualLow, richest.dualHigh)} in the first group to {pctRange(poorest.dualLow, poorest.dualHigh)} in
          the last, then asks two questions: do hospitals serving poorer patients get worse results, and is that about
          the patients or about the hospitals' money?
        </p>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat value={formatMoney(margin(richest), 'pct')} label="typical overall margin, fewest low-income patients" />
        <Stat value={formatMoney(margin(poorest), 'pct')} label="typical overall margin, most low-income patients" />
        <Stat value={overall.raw === null ? '—' : formatScore(overall.raw)} label="overall score gap before adjustment (poorest − richest fifth)" />
        <Stat value={overall.adjusted === null ? '—' : formatScore(overall.adjusted)} label="the same gap after adjusting for patients and community" />
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Before and after adjustment</h3>
          <div className="text-sm text-gray-700 mt-2 bg-white border border-gray-200 rounded-lg p-4 space-y-2 leading-relaxed max-w-3xl">
            <p>
              <strong>Unadjusted, hospitals serving the poorest patients score {overall.raw !== null && overall.raw < 0 ? 'lower' : 'higher'}</strong>{' '}
              ({overall.raw === null ? '—' : formatScore(overall.raw)} on the overall score, in units of the real spread
              between hospitals). Once the <a href={href('performance')} className="text-blue-600 hover:underline">expected scores</a> account
              for patients and community, the gap is {overall.adjusted === null ? '—' : formatScore(overall.adjusted)}:{' '}
              {overall.raw !== null && overall.adjusted !== null && Math.abs(overall.adjusted) < Math.abs(overall.raw) / 2
                ? 'most of the raw difference reflects who the hospitals serve, not how they perform.'
                : 'much of the difference remains after adjustment.'}
            </p>
            {flipped.length > 0 && (
              <p>
                <strong>But not everywhere.</strong> For {flipped.map(g => SCOPE_INFO[g.scope].label.toLowerCase()).join(' and ')}, adjusting
                reverses the picture: {flipped.map(g => `${formatScore(g.raw!)} before, ${formatScore(g.adjusted!)} after`).join('; ')}.
                Given their communities and peers, the model expects something different from these hospitals than
                their raw standing suggests. Adjusting for poverty can raise the bar as well as lower it.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Score">
          {SCOPES.map(s => (
            <button
              key={s} type="button" onClick={() => setScope(s)} aria-pressed={scope === s}
              className={`px-3 py-1.5 rounded-md text-sm ${scope === s ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'}`}
            >
              {SCOPE_INFO[s].label}
            </button>
          ))}
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-700"><strong>{SCOPE_INFO[scope].label}:</strong> {SCOPE_INFO[scope].help}</p>
          <p className="text-xs text-gray-500 mt-1">
            Average score per group. Before adjustment compares each hospital with the national median; after compares
            it with what its patients, community and peers predict. 0 is average or as expected; + is better.
          </p>
          <DotChart
            categories={fifths.map((f, i) => ({ label: FIFTH_LABELS[i].replace(' low-income patients', ''), sublabel: pctRange(f.dualLow, f.dualHigh) }))}
            series={[
              { name: 'Before adjustment', color: RAW, values: fifths.map(f => f.scores[scope]?.raw ?? null) },
              { name: 'After adjustment', color: ADJUSTED, values: fifths.map(f => f.scores[scope]?.adjusted ?? null) },
            ]}
            format={formatScore}
            ariaLabel={`${SCOPE_INFO[scope].label} score by fifth of low-income patients, before and after adjustment`}
          />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-blue-600 text-xs">Show every score as a table</summary>
            <table className="w-full mt-2 tabular-nums">
              <thead className="text-gray-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="py-1 text-left">Score</th>
                  <th className="py-1 text-right">Gap before adjustment</th>
                  <th className="py-1 text-right">Gap after</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {gaps.map(g => (
                  <tr key={g.scope}>
                    <td className="py-1">{SCOPE_INFO[g.scope].label}</td>
                    <td className="py-1 text-right">{g.raw === null ? '—' : formatScore(g.raw)}</td>
                    <td className="py-1 text-right">{g.adjusted === null ? '—' : formatScore(g.adjusted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-400 mt-1">Gap = average score of the fifth with the most low-income patients minus the fifth with the fewest.</p>
          </details>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-800">Money follows the patients</h3>
        <p className="text-sm text-gray-600 max-w-3xl">
          Medicaid pays hospitals less than Medicare or private insurance, so hospitals serving poorer patients have
          thinner margins. Typical (median) figures per group:
        </p>
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Low-income patients</th>
                {fifths.map((f, i) => <th key={f.fifth} className="px-3 py-2 text-right" title={FIFTH_LABELS[i]}>{pctRange(f.dualLow, f.dualHigh)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {MONEY.map(m => (
                <tr key={m}>
                  <th scope="row" className="px-4 py-2 text-left font-normal text-gray-700">{MONEY_LABELS[m].label}</th>
                  {fifths.map(f => <td key={f.fifth} className="px-3 py-2 text-right">{formatMoney(f.money[m]?.median ?? null, MONEY_LABELS[m].format)}</td>)}
                </tr>
              ))}
              <tr>
                <th scope="row" className="px-4 py-2 text-left font-normal text-gray-700">Medicare spending per patient (1 = national)</th>
                {fifths.map(f => <td key={f.fifth} className="px-3 py-2 text-right">{f.medianMspb === null ? '—' : f.medianMspb.toFixed(2)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-800">Does money buy quality among similar hospitals?</h3>
        <div className="text-sm text-gray-700 bg-white border border-gray-200 rounded-lg p-4 space-y-2 leading-relaxed max-w-3xl">
          <p>
            Comparing hospitals within the same group holds patient poverty roughly constant, so what's left is the
            hospital's own money. <strong>{MONEY_LABELS[withinAvg[0].metric].label}</strong> shows the strongest link with
            the adjusted overall score: {strengthOf(withinAvg[0].avg)} {(withinAvg[0].avg ?? 0) < 0 ? 'negative' : 'positive'}{' '}
            relationship (average rank correlation {(withinAvg[0].avg ?? 0).toFixed(2)}), followed by{' '}
            {MONEY_LABELS[withinAvg[1].metric].label.toLowerCase()} ({(withinAvg[1].avg ?? 0).toFixed(2)}). Profit itself
            matters less: overall margin averages {(withinAvg.find(w => w.metric === 'total_margin')?.avg ?? 0).toFixed(2)}.
          </p>
          <p className="text-gray-500">
            These are associations. A hospital that leans on agency nurses may be doing so <em>because</em> it's already
            struggling to staff, and spending more per patient partly reflects sicker patients.
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Rank correlation with the adjusted overall score</th>
                {fifths.map((f, i) => <th key={f.fifth} className="px-3 py-2 text-right" title={FIFTH_LABELS[i]}>{pctRange(f.dualLow, f.dualHigh)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {MONEY.map(m => (
                <tr key={m}>
                  <th scope="row" className="px-4 py-2 text-left font-normal text-gray-700">{MONEY_LABELS[m].label}</th>
                  {fifths.map(f => {
                    const v = f.within[m]?.spearman ?? null
                    return <td key={f.fifth} className={`px-3 py-2 text-right ${Math.abs(v ?? 0) >= 0.1 ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>{v === null ? '—' : v.toFixed(2)}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400">Values of 0.10 or more in either direction are shown darker. About {Math.round(total / fifths.length)} hospitals per group.</p>
      </section>

      <HowToRead
        items={[
          {
            term: 'Who is in these groups?',
            text: `The ${total.toLocaleString('en-US')} scored hospitals paid under Medicare's inpatient system, which publishes each hospital's dual-eligible share. Critical access hospitals, Maryland hospitals and specialty hospitals outside that system are not included.`,
          },
          {
            term: 'Why fifths of dual-eligible patients?',
            text: "It's how Medicare's Hospital Readmissions Reduction Program compares hospitals: each is judged against peers serving a similar share of dual-eligible patients rather than adjusting their scores. Each hospital's page shows where it ranks among its peer group on the unadjusted score.",
          },
          {
            term: 'Two ways to be fair',
            text: 'Adjusting for poverty stops hospitals from being blamed for their patients\' circumstances. But it can also hide real gaps in the care poor patients receive. That is why this site shows both: adjusted scores everywhere, and this page for the raw differences.',
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
