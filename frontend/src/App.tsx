import { useState, useEffect } from 'react'
import type { Category, CategoryRanking } from './types'
import TabNav from './components/TabNav'
import RankingSection from './components/RankingSection'
import axios from 'axios'

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'wait_times',   label: '⏱️ Wait Times' },
  { id: 'mortality',    label: '💀 Mortality' },
  { id: 'safety',       label: '🩺 Patient Safety' },
  { id: 'satisfaction', label: '😊 Satisfaction' },
  { id: 'readmission',  label: '🔄 Readmissions' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState<Category>('wait_times')
  const [data, setData] = useState<CategoryRanking | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    axios
      .get<CategoryRanking>(`/api/rankings/${activeTab}`)
      .then(res => setData(res.data))
      .catch(() =>
        setError('Failed to load rankings. The hospitals are probably fine though.')
      )
      .finally(() => setLoading(false))
  }, [activeTab])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900">🏥 HospitalRanker</h1>
        <p className="text-sm text-gray-500 mt-1">Serious data. Questionable commentary.</p>
      </header>

      <TabNav categories={CATEGORIES} active={activeTab} onChange={setActiveTab} />

      <main className="max-w-5xl mx-auto px-6 py-8">
        {loading && (
          <p className="text-center text-gray-400 py-16">
            Loading... please hold (much like a hospital waiting room)
          </p>
        )}
        {error && <p className="text-center text-red-500 py-16">{error}</p>}
        {data && !loading && <RankingSection data={data} />}
      </main>
    </div>
  )
}
