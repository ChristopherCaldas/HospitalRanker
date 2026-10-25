import { useState } from 'react'
import type { HospitalPerformance, Scope } from '../types'
import { GROUPS, SCOPE_INFO, pctRange } from '../lib/quality'
import { VERDICT_LABELS, formatScore } from '../lib/performance'
import { formatValue } from '../lib/format'
import { href } from '../lib/router'

const SERIES = '#2a78d6'
const ROWS: Scope[] = ['outcome', 'process', ...GROUPS]
const EXTENT = 2 // axis runs -2 to +2 typical spreads

// One row per domain and group: the score as a dot with its 95% range on a
// shared axis centered on "as expected". Rows are focusable; the exact
// numbers are in each row's text, so no tooltip is needed.
export function ScopeBreakdown({ scopes, peer }: Pick<HospitalPerformance, 'scopes' | 'peer'>) {
  const rows = ROWS.filter(s => scopes[s])
  if (rows.length === 0) return null
  const pos = (v: number) => `${((Math.max(-EXTENT, Math.min(EXTENT, v)) + EXTENT) / (2 * EXTENT)) * 100}%`
  return (
    <div className="mt-4 space-y-3">
      <table className="w-full text-sm">
        <caption className="sr-only">Scores by domain and measure group</caption>
        <thead className="text-xs text-gray-500">
          <tr>
            <th className="py-1 text-left font-normal">Score</th>
            <th className="py-1 font-normal w-2/5">
              <div className="flex justify-between"><span>worse</span><span>as expected</span><span>better</span></div>
            </th>
            <th className="py-1 text-right font-normal">Value</th>
            <th className="py-1 text-right font-normal hidden sm:table-cell">Rank</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const r = scopes[s]!
            const divider = i === 2 ? 'border-t border-gray-200' : ''
            return (
              <tr key={s} className={divider}>
                <td className={`py-1.5 pr-2 ${i < 2 ? 'font-medium text-gray-900' : 'text-gray-700 pl-3'}`} title={SCOPE_INFO[s].help}>
                  {SCOPE_INFO[s].label}
                  {r.verdict !== 'as_expected' && (
                    <span className={`ml-2 px-1 py-0.5 rounded border text-[11px] ${VERDICT_LABELS[r.verdict].className}`}>
                      {r.verdict === 'better' ? 'clearly better' : 'clearly worse'}
                    </span>
                  )}
                </td>
                <td className="py-1.5">
                  <div className="relative h-4" aria-hidden="true">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-gray-300" />
                    <div className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded" style={{ left: pos(r.score - 1.96 * r.scoreSe), right: `calc(100% - ${pos(r.score + 1.96 * r.scoreSe)})`, backgroundColor: SERIES, opacity: 0.45 }} />
                    <div className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white" style={{ left: pos(r.score), backgroundColor: SERIES }} />
                  </div>
                </td>
                <td className="py-1.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
                  {formatScore(r.score)} <span className="text-xs text-gray-400">±{(1.96 * r.scoreSe).toFixed(2)}</span>
                </td>
                <td className="py-1.5 text-right tabular-nums text-xs text-gray-500 hidden sm:table-cell whitespace-nowrap">
                  {r.nationalRank.toLocaleString('en-US')} of {r.nationalCount.toLocaleString('en-US')}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-xs text-gray-400">
        Dots past the ±{EXTENT} edges are drawn at the edge. Outcomes are what happened to patients; process is the care
        itself (<a href={href('framework')} className="text-blue-600 hover:underline">Donabedian's framework</a>).
      </p>
      {peer && (
        <p className="text-sm text-gray-700">
          <strong>Among similar hospitals:</strong> {pctRange(peer.dualLow, peer.dualHigh)} of this hospital's Medicare
          patients are low-income enough to also have Medicaid, like {peer.peerCount.toLocaleString('en-US')} other hospitals
          in its <a href={href('equity')} className="text-blue-600 hover:underline">peer group</a>. On the unadjusted score it
          ranks <strong>#{peer.peerRank.toLocaleString('en-US')}</strong> of them.
        </p>
      )}
    </div>
  )
}

// Every measure the model scored for this hospital, grouped, with actual vs.
// expected and the verdict.
export function AllMeasures({ measures }: { measures: HospitalPerformance['allMeasures'] }) {
  const [open, setOpen] = useState(false)
  if (measures.length === 0) return null
  const flagged = measures.filter(m => m.verdict !== 'as_expected').length
  return (
    <section className="bg-white border border-gray-200 rounded-lg">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-baseline justify-between gap-2 px-4 py-3 text-left">
        <span className="font-semibold text-gray-800">All {measures.length} quality measures</span>
        <span className="text-xs text-blue-600">{flagged > 0 ? `${flagged} clearly off expectations · ` : ''}{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-gray-100">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Measure</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-right">Actual</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right" title="Difference in units of the measure's typical hospital-to-hospital spread; + = better">Difference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {GROUPS.flatMap(g => {
                const rows = measures.filter(m => m.group === g)
                if (rows.length === 0) return []
                return [
                  <tr key={g} className="bg-gray-50/60">
                    <th colSpan={5} scope="colgroup" className="px-4 py-1.5 text-left text-xs font-semibold text-gray-600">{SCOPE_INFO[g].label}</th>
                  </tr>,
                  ...rows.map(m => (
                    <tr key={m.measureId}>
                      <td className="px-4 py-1.5 text-gray-800">
                        {m.name.replace(/ \(HCAHPS\)$/, '')}
                        {m.verdict !== 'as_expected' && (
                          <span className={`ml-2 px-1 py-0.5 rounded border text-[11px] ${VERDICT_LABELS[m.verdict].className}`}>
                            {m.verdict === 'better' ? 'clearly better' : 'clearly worse'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-gray-500 text-xs">{m.domain}</td>
                      <td className="px-3 py-1.5 text-right">{formatValue(m.actual, m.unit)}</td>
                      <td className="px-3 py-1.5 text-right text-gray-500">{formatValue(m.expected, m.unit)}</td>
                      <td className="px-3 py-1.5 text-right text-gray-800">{formatScore(m.gapSd)}</td>
                    </tr>
                  )),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
