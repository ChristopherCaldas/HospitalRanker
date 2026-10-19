import type { Hospital } from '../types'
import { COMPARISON_HELP, formatValue, shortComparison } from '../lib/format'
import { href } from '../lib/router'

interface Props {
  hospitals: Hospital[]
  unit: string
  caseNoun: string | null
  showCases: boolean
}

const TONE = {
  better: 'bg-green-50 text-green-800 border-green-200',
  same: 'bg-gray-50 text-gray-600 border-gray-200',
  worse: 'bg-red-50 text-red-800 border-red-200',
}

export default function RankingTable({ hospitals, unit, caseNoun, showCases }: Props) {
  const showComparison = hospitals.some(h => h.comparedToNational)

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
          <tr>
            <th className="px-4 py-2 text-left">#</th>
            <th className="px-4 py-2 text-left">Hospital</th>
            {showCases && <th className="px-4 py-2 text-right" title={caseNoun ? `Number of ${caseNoun}` : undefined}>Cases</th>}
            <th className="px-4 py-2 text-right">Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {hospitals.map((h, i) => {
            const comparison = showComparison ? shortComparison(h.comparedToNational) : null
            return (
              <tr key={h.id} className="hover:bg-gray-50 align-top">
                <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                <td className="px-4 py-3">
                  <a href={href('hospitals', h.id)} className="font-medium text-gray-800 hover:text-blue-700 hover:underline">
                    {h.name}
                  </a>
                  <div className="text-gray-500 text-xs mt-0.5">
                    {h.city}, {h.state}
                  </div>
                  {comparison && (
                    <span title={COMPARISON_HELP} className={`inline-block mt-1 px-1.5 py-0.5 rounded border text-xs ${TONE[comparison.tone]}`}>
                      {comparison.label}
                    </span>
                  )}
                </td>
                {showCases && (
                  <td className="px-4 py-3 text-right text-gray-500 tabular-nums">
                    {h.cases?.toLocaleString('en-US') ?? '—'}
                  </td>
                )}
                <td className="px-4 py-3 text-right font-mono text-gray-700 whitespace-nowrap">
                  {formatValue(h.score, unit)}
                  {h.lowerEstimate !== null && h.higherEstimate !== null && (
                    <div className="text-xs text-gray-400 font-sans" title="CMS 95% interval: the true score very likely falls in this range">
                      {formatValue(h.lowerEstimate, unit)}–{formatValue(h.higherEstimate, unit)}
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
