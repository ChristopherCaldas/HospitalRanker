import { useEffect, useState } from 'react'
import axios from 'axios'
import type { ChainOverview, ChainTest } from '../types'
import { PAIR_REASONS, chainLabel, isSignificant, strengthOf, structurePhrase } from '../lib/quality'
import { formatScore } from '../lib/performance'
import { href } from '../lib/router'

// Live test of Donabedian's chain on this site's data (analysis/chain.ts).
export default function ChainSection() {
  const [data, setData] = useState<ChainOverview | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    axios.get<ChainOverview>('/api/quality/chain').then(res => setData(res.data)).catch(() => setError(true))
  }, [])
  if (error) return <p className="text-sm text-red-500">Couldn't load the chain test.</p>
  if (!data) return <p className="text-sm text-gray-400">Loading the chain test…</p>
  return <ChainReport tests={data.tests} />
}

const r2 = (v: number | null) => (v === null ? '—' : v.toFixed(2))

export function ChainReport({ tests }: { tests: ChainTest[] }) {
  const find = (link: ChainTest['link'], x: string, y: string) => tests.find(t => t.link === link && t.x === x && t.y === y)
  const po = find('process_outcome', 'process', 'clinical_outcome')
  const clinical = find('process_outcome', 'timely_effective', 'clinical_outcome')
  const structure = [...new Set(tests.filter(t => t.link === 'structure_process').map(t => t.x))]
    .map(x => ({ x, process: find('structure_process', x, 'process'), outcome: find('structure_outcome', x, 'clinical_outcome') }))
    .sort((a, b) => Math.abs(b.process?.r ?? 0) - Math.abs(a.process?.r ?? 0))
  const topStructure = structure.filter(s => s.process && isSignificant(s.process)).slice(0, 3)
  const pairs = tests.filter(t => t.link === 'pair')
  const throughProcess = structure.filter(s => {
    const o = s.outcome
    return o && o.r !== null && o.partialR !== null && isSignificant(o) && Math.abs(o.partialR) < Math.abs(o.r) * 0.6
  })
  const direct = structure.filter(s => {
    const o = s.outcome
    return o && o.r !== null && o.partialR !== null && isSignificant(o) && Math.abs(o.partialR) >= Math.abs(o.r) * 0.6 && Math.abs(o.r) >= 0.08
  })

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-800">Does the chain hold? A test on U.S. hospitals</h3>
        <p className="text-sm text-gray-600 mt-1 max-w-3xl leading-relaxed">
          Donabedian's links can be checked with this site's data. Each hospital's process and outcome scores already
          account for its patients, community and peers (the <a href={href('performance')} className="text-blue-700 hover:underline">expected scores</a>),
          so a link here isn't just "hospitals in richer areas do better at everything". Structure comes from the cost
          reports every hospital files with Medicare.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-3 text-sm">
        <LinkCard step="Structure → process">
          {topStructure.length > 0 ? (
            <>Better process goes with {topStructure.map(s => `${structurePhrase(s.x, s.process!.r!)} (${r2(s.process!.r)})`).join(', ')}.</>
          ) : 'No structure variable clearly goes with better process.'}
        </LinkCard>
        <LinkCard step="Process → outcome">
          {po && po.r !== null ? (
            <>
              {strengthOf(po.r).replace(/^./, c => c.toUpperCase())} link (r = {r2(po.r)}): hospitals in the best fifth on process average{' '}
              {formatScore(po.topFifth!)} on clinical outcomes, the worst fifth {formatScore(po.bottomFifth!)}.
              {clinical && clinical.r !== null && <> Counting only timely and effective care (no surveys), r = {r2(clinical.r)}.</>}
            </>
          ) : 'Not enough data.'}
        </LinkCard>
        <LinkCard step="Structure → outcome">
          {throughProcess.length > 0 && <>{throughProcess.map(s => chainLabel(s.x)).join(', ')}: linked to outcomes mostly <em>through</em> better process. </>}
          {direct.length > 0 && <>{direct.map(s => chainLabel(s.x)).join(', ')}: linked to outcomes even with process held equal.</>}
          {throughProcess.length === 0 && direct.length === 0 && 'Structure has little direct link to outcomes.'}
        </LinkCard>
      </div>

      {po && po.r !== null && Math.abs(po.r) < 0.3 && <div className="text-sm text-gray-700 bg-white border border-gray-200 rounded-lg p-4 leading-relaxed max-w-3xl">
        <strong>The links are real but loose.</strong> That matches Donabedian's own wording: good structure and process
        make good outcomes <em>more likely</em>, not certain. It's also why process measures can't stand in for outcomes,
        and why this site reports both. Correlations of 0.1–0.2 across thousands of hospitals are statistically clear but
        leave most of the variation unexplained.
      </div>}

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="text-left px-4 pt-3 pb-1 font-semibold text-gray-800">Specific care, specific results</caption>
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">Process</th>
              <th className="px-4 py-2 text-left">Outcome</th>
              <th className="px-4 py-2 text-left">Why they might be linked</th>
              <th className="px-4 py-2 text-right">Correlation</th>
              <th className="px-4 py-2 text-left">Clear link?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 align-top">
            {pairs.map(t => (
              <tr key={`${t.x}-${t.y}`}>
                <td className="px-4 py-2 text-gray-900">{chainLabel(t.x)}</td>
                <td className="px-4 py-2 text-gray-900">{chainLabel(t.y)}</td>
                <td className="px-4 py-2 text-gray-600">{PAIR_REASONS[`${t.x} ${t.y}`] ?? ''}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r2(t.r)}
                  {t.rCiLow !== null && <span className="text-gray-400 text-xs"> ({r2(t.rCiLow)} to {r2(t.rCiHigh)})</span>}
                </td>
                <td className="px-4 py-2">{isSignificant(t) && (t.r ?? 0) >= 0.1 ? 'Yes' : isSignificant(t) ? 'Barely' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="bg-white border border-gray-200 rounded-lg text-sm">
        <summary className="px-4 py-3 cursor-pointer text-blue-600 text-xs">Every structure variable</summary>
        <div className="overflow-x-auto">
          <table className="w-full tabular-nums">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Structure</th>
                <th className="px-4 py-2 text-right">With process</th>
                <th className="px-4 py-2 text-right">With clinical outcomes</th>
                <th className="px-4 py-2 text-right">…with process held equal</th>
                <th className="px-4 py-2 text-right">Hospitals</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {structure.map(s => (
                <tr key={s.x}>
                  <td className="px-4 py-2">{chainLabel(s.x)}</td>
                  <td className={`px-4 py-2 text-right ${s.process && isSignificant(s.process) ? 'text-gray-900' : 'text-gray-400'}`}>{r2(s.process?.r ?? null)}</td>
                  <td className={`px-4 py-2 text-right ${s.outcome && isSignificant(s.outcome) ? 'text-gray-900' : 'text-gray-400'}`}>{r2(s.outcome?.r ?? null)}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{r2(s.outcome?.partialR ?? null)}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{(s.outcome?.n ?? s.process?.n ?? 0).toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-gray-400">
            Pearson correlations; positive = more of the variable goes with better scores. Gray = not significant after
            correcting for the number of tests (false discovery rate 5%).
          </p>
        </div>
      </details>
    </section>
  )
}

function LinkCard({ step, children }: { step: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{step}</div>
      <p className="mt-1 text-gray-700">{children}</p>
    </div>
  )
}
