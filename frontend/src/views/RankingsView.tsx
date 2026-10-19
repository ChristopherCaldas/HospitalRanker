import { useEffect, useState } from 'react'
import axios from 'axios'
import type { Category, CategoryRanking } from '../types'
import { CATEGORIES } from '../lib/format'
import { href } from '../lib/router'
import TabNav from '../components/TabNav'
import RankingSection from '../components/RankingSection'

// Hospitals below this many cases can top a list on a handful of patients.
const MIN_CASE_OPTIONS = [0, 25, 100, 500]
const DEFAULT_MIN_CASES = 25

export default function RankingsView({ category }: { category: Category }) {
  const [minCases, setMinCases] = useState(DEFAULT_MIN_CASES)
  const [data, setData] = useState<CategoryRanking | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    axios
      .get<CategoryRanking>(`/api/rankings/${category}`, { params: { minCases } })
      .then(res => setData(res.data))
      .catch(() => setError('Failed to load rankings. The hospitals are probably fine though.'))
      .finally(() => setLoading(false))
  }, [category, minCases])

  return (
    <>
      <TabNav categories={CATEGORIES} active={category} hrefFor={c => href('rankings', c)} />

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex flex-wrap items-center gap-2 mb-6 text-sm">
          <label htmlFor="min-cases" className="text-gray-600">Minimum cases</label>
          <select
            id="min-cases"
            value={data && !data.hasCaseCounts ? 0 : minCases}
            onChange={e => setMinCases(Number(e.target.value))}
            disabled={data !== null && !data.hasCaseCounts}
            className="border border-gray-300 rounded-md px-2 py-1 bg-white disabled:text-gray-400"
          >
            {MIN_CASE_OPTIONS.map(n => (
              <option key={n} value={n}>{n === 0 ? 'Any' : `${n}+`}</option>
            ))}
          </select>
          {data && !data.hasCaseCounts && (
            <span className="text-gray-400">CMS publishes no case counts for this measure.</span>
          )}
        </div>

        {loading && !data && (
          <p className="text-center text-gray-400 py-16">
            Loading... please hold (much like a hospital waiting room)
          </p>
        )}
        {error && <p className="text-center text-red-500 py-16">{error}</p>}
        {data && !error && (
          <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <RankingSection data={data} />
          </div>
        )}
      </main>
    </>
  )
}
