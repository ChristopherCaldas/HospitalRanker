import type { Category, CategoryRanking } from '../types'
import { COMPARISON_HELP, MEASURE_GUIDE, formatMonth } from '../lib/format'
import { href } from '../lib/router'
import RankingTable from './RankingTable'
import QuipCard from './QuipCard'
import HowToRead from './HowToRead'

interface Props {
  data: CategoryRanking
}

export default function RankingSection({ data }: Props) {
  const guide = MEASURE_GUIDE[data.category as Category]
  const hasIntervals = [...data.top5, ...data.bottom5].some(h => h.lowerEstimate !== null)
  const hasVerdicts = [...data.top5, ...data.bottom5].some(h => h.comparedToNational)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-800 mb-1">{data.label}</h2>
        <p className="text-sm text-gray-600">{guide?.score ?? data.description}</p>
        {data.periodStart && data.periodEnd && (
          <p className="text-xs text-gray-500 mt-2">
            Care delivered {formatMonth(data.periodStart)} – {formatMonth(data.periodEnd)}
            {data.released && <>, published by CMS in {formatMonth(data.released)}</>}
            {data.minCases > 0 && guide?.caseNoun && <> · only hospitals with at least {data.minCases} {guide.caseNoun}</>}
            {' · '}
            <a href={href('states', data.category)} className="text-blue-600 hover:underline">
              How do states compare?
            </a>
          </p>
        )}
      </div>

      <HowToRead
        open
        items={[
          {
            term: 'Score',
            text: (
              <>
                {data.higherIsBetter ? 'Higher is better.' : 'Lower is better.'} {guide?.example}
              </>
            ),
          },
          ...(guide?.caseNoun
            ? [{
                term: 'Cases',
                text: `How many ${guide.caseNoun} the score is based on. Scores from small numbers swing a lot by luck, so the "Minimum cases" filter hides hospitals below a threshold.`,
              }]
            : [{ term: 'Cases', text: "CMS doesn't publish patient counts for this measure, so the minimum-cases filter doesn't apply." }]),
          ...(hasIntervals
            ? [{
                term: 'Gray range',
                text: "CMS's 95% interval (its margin of error): the hospital's true score very likely falls somewhere in this range.",
              }]
            : []),
          ...(hasVerdicts ? [{ term: 'Badge', text: COMPARISON_HELP }] : []),
          {
            term: 'Why the dates?',
            text: 'CMS publishes these scores a year or more after the care happened, and some measures pool several years to get enough patients.',
          },
        ]}
      />

      <details className="text-sm text-gray-500">
        <summary className="cursor-pointer select-none">Technical definition ({data.measureId})</summary>
        <p className="mt-2 leading-relaxed text-gray-400">{data.technicalDescription}</p>
      </details>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-green-600 font-semibold mb-3">🏆 Top 5 Best</h3>
          <QuipCard quip={data.bestQuip} type="best" />
          <RankingTable hospitals={data.top5} unit={data.unit} caseNoun={guide?.caseNoun ?? null} showCases={data.hasCaseCounts} />
        </div>

        <div>
          <h3 className="text-red-500 font-semibold mb-3">💩 Bottom 5 Worst</h3>
          <QuipCard quip={data.worstQuip} type="worst" />
          <RankingTable hospitals={data.bottom5} unit={data.unit} caseNoun={guide?.caseNoun ?? null} showCases={data.hasCaseCounts} />
        </div>
      </div>
    </div>
  )
}
