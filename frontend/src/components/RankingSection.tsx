import type { CategoryRanking } from '../types'
import { formatMonth } from '../lib/format'
import { href } from '../lib/router'
import RankingTable from './RankingTable'
import QuipCard from './QuipCard'

interface Props {
  data: CategoryRanking
}

export default function RankingSection({ data }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-800 mb-1">{data.label}</h2>
        <p className="text-sm text-gray-500">{data.description}</p>
        <p className="text-sm text-gray-400 mt-2 leading-relaxed">{data.technicalDescription}</p>
        {data.periodStart && data.periodEnd && (
          <p className="text-xs text-gray-400 mt-2">
            {data.measureId} · covers {formatMonth(data.periodStart)} – {formatMonth(data.periodEnd)}
            {data.released && <> · CMS release {formatMonth(data.released)}</>}
            {data.minCases > 0 && <> · hospitals with {data.minCases}+ cases</>}
            {' · '}
            <a href={href('states', data.category)} className="text-blue-600 hover:underline">
              How do states compare?
            </a>
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-green-600 font-semibold mb-3">🏆 Top 5 Best</h3>
          <QuipCard quip={data.bestQuip} type="best" />
          <RankingTable hospitals={data.top5} unit={data.unit} showCases={data.hasCaseCounts} />
        </div>

        <div>
          <h3 className="text-red-500 font-semibold mb-3">💩 Bottom 5 Worst</h3>
          <QuipCard quip={data.worstQuip} type="worst" />
          <RankingTable hospitals={data.bottom5} unit={data.unit} showCases={data.hasCaseCounts} />
        </div>
      </div>
    </div>
  )
}
