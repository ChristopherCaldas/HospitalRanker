import { useEffect, useState, type FormEvent } from 'react'
import axios from 'axios'
import type { Nearby, NearbyHospital, Scope } from '../types'
import { GROUPS, SCOPE_INFO } from '../lib/quality'
import { VERDICT_LABELS, formatScore } from '../lib/performance'
import { href } from '../lib/router'
import HowToRead from '../components/HowToRead'

export const RADII = [10, 25, 50, 100]
const SCOPES: Scope[] = ['overall', 'outcome', 'process', ...GROUPS]
const ZIP_KEY = 'nearby-zip'
// Below this many scored hospitals, one ranked list instead of best/worst.
const SHORT_LIST = 10

type Query = { zip: string } | { lat: number; lon: number }

const storedZip = () => {
  try {
    return localStorage.getItem(ZIP_KEY) ?? ''
  } catch {
    return ''
  }
}
const storeZip = (zip: string) => {
  try {
    localStorage.setItem(ZIP_KEY, zip)
  } catch {
    // Private windows and blocked storage: nothing to remember.
  }
}

export default function NearbyView({ zip: routeZip }: { zip?: string }) {
  const initial = routeZip && /^\d{5}$/.test(routeZip) ? routeZip : storedZip()
  const [input, setInput] = useState(initial)
  const [query, setQuery] = useState<Query | null>(initial ? { zip: initial } : null)
  const [miles, setMiles] = useState(25)
  const [scope, setScope] = useState<Scope>('overall')
  const [fullServiceOnly, setFullServiceOnly] = useState(true)
  const [data, setData] = useState<Nearby | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (routeZip && /^\d{5}$/.test(routeZip)) {
      setInput(routeZip)
      setQuery({ zip: routeZip })
    }
  }, [routeZip])

  useEffect(() => {
    if (!query) return
    let current = true
    setLoading(true)
    axios
      .get<Nearby>('/api/nearby', { params: { ...query, miles, scope } })
      .then(res => {
        if (!current) return
        setData(res.data)
        setError(null)
        setInput(res.data.origin.zip)
        if ('zip' in query) storeZip(query.zip)
      })
      .catch(err => {
        if (!current) return
        setData(null)
        setError(err.response?.status === 404 ? "We couldn't find that ZIP code." : "Couldn't load nearby hospitals. Try again in a moment.")
      })
      .finally(() => current && setLoading(false))
    return () => {
      current = false
    }
  }, [query, miles, scope])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const zip = input.trim()
    if (!/^\d{5}$/.test(zip)) {
      setError('Enter a 5-digit ZIP code.')
      return
    }
    // The hash carries the ZIP so the search can be shared or bookmarked.
    if (zip === routeZip) setQuery({ zip })
    else window.location.hash = href('nearby', zip)
  }

  const locate = () => {
    if (!navigator.geolocation) {
      setError("Your browser doesn't share its location. Enter a ZIP code instead.")
      return
    }
    setLoading(true)
    navigator.geolocation.getCurrentPosition(
      // Rounded to about half a mile: plenty for a 10-mile radius.
      pos => setQuery({ lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 }),
      () => {
        setLoading(false)
        setError("Couldn't get your location. Enter a ZIP code instead.")
      },
      { maximumAge: 600_000, timeout: 15_000 }
    )
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">Hospitals near you</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          Enter a ZIP code or share your location to see the best and worst hospitals within driving range, scored the
          same way as the <a href={href('performance')} className="text-blue-600 hover:underline">Expected vs. actual</a>{' '}
          leaderboard.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          type="text" inputMode="numeric" autoComplete="postal-code" maxLength={5} pattern="\d{5}"
          value={input} onChange={e => setInput(e.target.value.replace(/\D/g, ''))}
          placeholder="ZIP code" aria-label="ZIP code"
          className="w-28 border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
        />
        <button type="submit" className="px-3 py-2 rounded-md text-sm font-medium bg-gray-900 text-white hover:bg-gray-700">
          Search
        </button>
        <button
          type="button" onClick={locate}
          className="px-3 py-2 rounded-md text-sm bg-white border border-gray-300 text-gray-700 hover:bg-gray-100"
        >
          Use my location
        </button>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 ml-auto">
          Within
          <select
            value={miles} onChange={e => setMiles(Number(e.target.value))}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white"
          >
            {RADII.map(r => <option key={r} value={r}>{r} miles</option>)}
          </select>
        </label>
      </form>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Score">
          {SCOPES.map(s => (
            <button
              key={s} type="button" onClick={() => setScope(s)} aria-pressed={scope === s} title={SCOPE_INFO[s].help}
              className={`px-3 py-1.5 rounded-md text-sm ${scope === s ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'}`}
            >
              {SCOPE_INFO[s].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">{SCOPE_INFO[scope].help}</p>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={fullServiceOnly} onChange={e => setFullServiceOnly(e.target.checked)} />
          Full-service hospitals only (leaves out specialty hospitals, which report fewer measures and often top the list)
        </label>
      </div>

      {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}
      {loading && !data && <p className="text-gray-400 text-sm">Searching…</p>}
      {!query && !error && (
        <p className="text-gray-400 text-sm">
          Your location is only used for this search: it's rounded to about half a mile, turned into the nearest ZIP
          code, and not stored.
        </p>
      )}
      {data && (
        <div className={loading ? 'opacity-60 transition-opacity' : undefined}>
          <NearbyReport data={data} fullServiceOnly={fullServiceOnly} />
        </div>
      )}

      <HowToRead
        items={[
          {
            term: 'Score',
            text: "How far the hospital's results are from what you'd expect given its patients and community, in typical hospital-to-hospital differences. +1 means one typical difference better than expected. The ± figure is the 95% margin of error.",
          },
          {
            term: 'Why adjusted?',
            text: "Adjustment credits hospitals that serve poorer, sicker communities. Hospitals near each other share most of that context, so a local ranking mostly reflects the hospitals themselves. CMS's own star rating is shown alongside for comparison.",
          },
          {
            term: 'Clearly better / worse',
            text: 'Only hospitals whose whole margin of error lies at least one typical difference from expected get a label. Most hospitals are within the normal range.',
          },
          {
            term: 'Distance',
            text: "Straight-line miles between ZIP code centers, not driving distance. A hospital listed at 0 miles is in your ZIP code.",
          },
        ]}
      />
    </main>
  )
}

// The results, rendered from data (SSR-tested in NearbyView.test.tsx).
export function NearbyReport({ data, fullServiceOnly }: { data: Nearby; fullServiceOnly: boolean }) {
  const label = data.scope === 'overall' ? 'an overall score' : `a ${SCOPE_INFO[data.scope].label.toLowerCase()} score`
  const scoredAll = data.hospitals.filter(h => h.score !== null)
  const scored = scoredAll.filter(h => !fullServiceOnly || h.overallGroups === 5)
  const specialty = scoredAll.length - scored.length
  const better = scored.filter(h => h.verdict === 'better').length
  const worse = scored.filter(h => h.verdict === 'worse').length
  const place = `${data.miles} miles of ZIP ${data.origin.zip}`

  if (data.hospitals.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        No hospitals within {place}.{data.miles < 100 && ' Try a wider radius.'}
      </p>
    )
  }

  return (
    <section className="space-y-4">
      <p className="text-sm text-gray-600 max-w-3xl">
        {data.hospitals.length} {data.hospitals.length === 1 ? 'hospital' : 'hospitals'} within {place}
        {data.origin.approximate && ' (that ZIP has no Census area, so we used the center of its region)'}.{' '}
        {scored.length === 0
          ? `None of the ${fullServiceOnly ? 'full-service ones ' : ''}has enough data for ${label}.`
          : <>
              {scored.length} {fullServiceOnly ? 'full-service ' : ''}{scored.length === 1 ? 'has' : 'have'} {label}
              {specialty > 0 && ` (${specialty} specialty ${specialty === 1 ? 'hospital' : 'hospitals'} left out)`}:{' '}
              <strong className="text-green-800">{better}</strong> clearly better than expected,{' '}
              <strong className="text-red-800">{worse}</strong> clearly worse, the rest within the normal range.
            </>}
        {scored.length === 0 && data.miles < 100 && ' Try a wider radius.'}
      </p>

      {scored.length > 0 && scored.length <= SHORT_LIST && (
        <NearbyTable title="Best to worst" tone="text-gray-800" rows={scored} rank={i => i + 1} />
      )}
      {scored.length > SHORT_LIST && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <NearbyTable title="Best nearby" tone="text-green-700" rows={scored.slice(0, 5)} rank={i => i + 1} />
          <NearbyTable
            title="Worst nearby" tone="text-red-700" rows={scored.slice(-5).reverse()} rank={i => scored.length - i}
          />
        </div>
      )}

      {(scored.length > SHORT_LIST || scored.length < data.hospitals.length) && (
        <details className="bg-white border border-gray-200 rounded-lg text-sm">
          <summary className="px-4 py-3 font-semibold text-gray-700 cursor-pointer select-none">
            All {data.hospitals.length} hospitals within {data.miles} miles
          </summary>
          <AllHospitals hospitals={data.hospitals} />
        </details>
      )}
    </section>
  )
}

function Notes({ h }: { h: NearbyHospital }) {
  return (
    <>
      <div className="text-xs text-gray-500">
        {h.city}, {h.state} · {h.miles < 1 ? 'under a mile' : `${h.miles.toFixed(0)} mi`}
        {h.overallRating !== null && ` · CMS ${h.overallRating} of 5 stars`}
      </div>
      <div className="flex flex-wrap gap-1 mt-1">
        {h.verdict && h.verdict !== 'as_expected' && (
          <span className={`px-1.5 py-0.5 rounded border text-xs ${VERDICT_LABELS[h.verdict].className}`}>
            {VERDICT_LABELS[h.verdict].label}
          </span>
        )}
        {h.overallGroups !== null && h.overallGroups < 5 && (
          <span className="px-1.5 py-0.5 rounded border text-xs bg-amber-50 text-amber-800 border-amber-200" title="Reports fewer of CMS's five measure groups, usually a specialty hospital">
            Specialty ({h.overallGroups} of 5 groups)
          </span>
        )}
        {h.emergencyServices === false && (
          <span className="px-1.5 py-0.5 rounded border text-xs bg-gray-50 text-gray-600 border-gray-200">No emergency room</span>
        )}
      </div>
    </>
  )
}

function NearbyTable({ title, tone, rows, rank }: {
  title: string
  tone: string
  rows: NearbyHospital[]
  rank: (i: number) => number
}) {
  return (
    <div>
      <h3 className={`font-semibold mb-2 ${tone}`}>{title}</h3>
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Hospital</th>
              <th className="px-3 py-2 text-right" title="Difference from expected, in typical hospital-to-hospital differences">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((h, i) => (
              <tr key={h.id} className="align-top">
                <td className="px-3 py-2 text-gray-400 tabular-nums">{rank(i)}</td>
                <td className="px-3 py-2">
                  <a href={href('hospitals', h.id)} className="font-medium text-gray-800 hover:text-blue-700 hover:underline">{h.name}</a>
                  <Notes h={h} />
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-700 whitespace-nowrap">
                  {formatScore(h.score!)}
                  <div className="text-xs text-gray-400 font-sans">±{(1.96 * h.scoreSe!).toFixed(2)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AllHospitals({ hospitals }: { hospitals: NearbyHospital[] }) {
  return (
    <div className="overflow-x-auto border-t border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
          <tr>
            <th className="px-3 py-2 text-left">Hospital</th>
            <th className="px-3 py-2 text-right">Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {hospitals.map(h => (
            <tr key={h.id} className="align-top">
              <td className="px-3 py-2">
                <a href={href('hospitals', h.id)} className="font-medium text-gray-800 hover:text-blue-700 hover:underline">{h.name}</a>
                <Notes h={h} />
              </td>
              <td className="px-3 py-2 text-right font-mono text-gray-700 whitespace-nowrap">
                {h.score === null
                  ? <span className="font-sans text-xs text-gray-400">Not enough data</span>
                  : formatScore(h.score)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
