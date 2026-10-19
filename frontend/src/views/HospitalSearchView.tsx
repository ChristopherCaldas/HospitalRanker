import { useEffect, useState } from 'react'
import axios from 'axios'
import type { HospitalSummary } from '../types'
import { href } from '../lib/router'

const STATES = [
  'AK','AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','HI','IA','ID','IL','IN','KS','KY','LA','MA','MD',
  'ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ','NM','NV','NY','OH','OK','OR','PA','PR','RI','SC',
  'SD','TN','TX','UT','VA','VT','WA','WI','WV','WY',
]

export default function HospitalSearchView() {
  const [q, setQ] = useState('')
  const [state, setState] = useState('')
  const [results, setResults] = useState<HospitalSummary[] | null>(null)
  const [error, setError] = useState(false)

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    if (!q.trim() && !state) {
      setResults(null)
      return
    }
    const timer = setTimeout(() => {
      axios
        .get<HospitalSummary[]>('/api/hospitals', { params: { q, state: state || undefined, limit: 30 } })
        .then(res => {
          setResults(res.data)
          setError(false)
        })
        .catch(() => setError(true))
    }, 250)
    return () => clearTimeout(timer)
  }, [q, state])

  return (
    <main className="max-w-3xl mx-auto px-6 py-8">
      <h2 className="text-xl font-semibold text-gray-800">Find a hospital</h2>
      <p className="text-sm text-gray-500 mt-1">
        See how it scores on every measure, where it stands within its state, and what CMS says about it.
      </p>

      <div className="flex flex-wrap gap-2 mt-4">
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Hospital name or city"
          aria-label="Hospital name or city"
          autoFocus
          className="flex-1 min-w-[200px] border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
        />
        <select
          value={state}
          onChange={e => setState(e.target.value)}
          aria-label="State"
          className="border border-gray-300 rounded-md px-2 py-2 text-sm bg-white"
        >
          <option value="">All states</option>
          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {!results && !error && (
        <p className="text-gray-400 text-sm mt-6">
          Try a name like “Mayo” or a city like “Boston”, or pick a state to list its hospitals. Covers every
          Medicare-certified hospital CMS reports on, about 5,400.
        </p>
      )}
      {error && <p className="text-red-500 text-sm mt-6">Search failed. Try again in a moment.</p>}
      {results && results.length === 0 && <p className="text-gray-400 text-sm mt-6">No hospitals match.</p>}
      {results && results.length > 0 && (
        <ul className="mt-6 bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {results.map(h => (
            <li key={h.id}>
              <a href={href('hospitals', h.id)} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50">
                <span>
                  <span className="font-medium text-gray-800">{h.name}</span>
                  <span className="block text-xs text-gray-500">
                    {h.city}, {h.state}{h.hospitalType ? ` · ${h.hospitalType}` : ''}
                  </span>
                </span>
                {h.overallRating !== null && (
                  <span className="text-sm text-gray-600 whitespace-nowrap" title="CMS's overall star rating, a summary across dozens of quality measures">
                    CMS rating {h.overallRating} of 5
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
