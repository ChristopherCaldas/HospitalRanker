import type { CategoryRanking } from '../types'
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-green-600 font-semibold mb-3">
            {data.higherIsBetter ? '🏆 Top 5 Best' : '🏆 Top 5 Best'}
          </h3>
          <QuipCard quip={data.bestQuip} type="best" />
          <RankingTable hospitals={data.top5} rank="top" />
        </div>

        <div>
          <h3 className="text-red-500 font-semibold mb-3">💩 Bottom 5 Worst</h3>
          <QuipCard quip={data.worstQuip} type="worst" />
          <RankingTable hospitals={data.bottom5} rank="bottom" />
        </div>
      </div>
    </div>
  )
}
