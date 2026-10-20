import type { Category } from './types'
import { CATEGORIES } from './lib/format'
import { href, useHashRoute } from './lib/router'
import RankingsView from './views/RankingsView'
import StatesView from './views/StatesView'
import PerformanceView from './views/PerformanceView'
import HospitalSearchView from './views/HospitalSearchView'
import HospitalDetailView from './views/HospitalDetailView'

const SECTIONS = [
  { id: 'rankings', label: 'Rankings' },
  { id: 'performance', label: 'Expected vs. actual' },
  { id: 'states', label: 'States' },
  { id: 'hospitals', label: 'Hospitals' },
]

const asCategory = (value: string | undefined): Category =>
  CATEGORIES.some(c => c.id === value) ? (value as Category) : 'wait_times'

export default function App() {
  const [section = 'rankings', arg] = useHashRoute()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              <a href={href('rankings')}>🏥 HospitalRanker</a>
            </h1>
            <p className="text-sm text-gray-500 mt-1">The report card hospitals didn't ask for, built from public CMS and CDC data.</p>
          </div>
          <nav className="flex gap-1" aria-label="Sections">
            {SECTIONS.map(s => (
              <a
                key={s.id}
                href={href(s.id)}
                aria-current={section === s.id ? 'page' : undefined}
                className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                  section === s.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {s.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      {section === 'states' && <StatesView category={asCategory(arg)} />}
      {section === 'performance' && <PerformanceView category={asCategory(arg)} />}
      {section === 'hospitals' && (arg ? <HospitalDetailView id={arg} /> : <HospitalSearchView />)}
      {!['states', 'performance', 'hospitals'].includes(section) && <RankingsView category={asCategory(arg)} />}
    </div>
  )
}
