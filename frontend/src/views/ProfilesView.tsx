import { useEffect, useState } from 'react'
import axios from 'axios'
import type { HospitalDetail, HospitalQualityMeasure, HospitalSummary, ProfileExtras, Scope } from '../types'
import { FEATURED, featuredBySlug, titleCase, type Featured } from '../lib/profiles'
import { GROUPS, SCOPE_INFO } from '../lib/quality'
import { NOTE_KINDS, VERDICT_LABELS, formatScore } from '../lib/performance'
import { CATEGORIES, formatMonth, formatValue } from '../lib/format'
import { divergingColor, textOn } from '../lib/colors'
import { href } from '../lib/router'
import { AllMeasures, ScopeBreakdown } from '../components/QualityBreakdown'
import TrendChart, { TrendLegend } from '../components/TrendChart'
import { ContextCard, FinanceCard } from './HospitalDetailView'

// In-depth profiles: featured hospitals as tabs (a system shows its hospitals
// side by side first), and any other hospital by its CMS ID.
//   #/profiles                      first featured profile
//   #/profiles/:slug                a featured profile
//   #/profiles/:slug/:id            one hospital of a featured system
//   #/profiles/:id                  any hospital
export default function ProfilesView({ path }: { path: string[] }) {
  const [key = FEATURED[0].slug, member] = path
  const featured = featuredBySlug(key)
  const hospitalId = featured ? (featured.ids.length === 1 ? featured.ids[0] : member) : key

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">Hospital profiles</h2>
        <p className="text-sm text-gray-600 mt-1 max-w-3xl leading-relaxed">
          An in-depth look at one hospital at a time, organized the way{' '}
          <a href={href('framework')} className="text-blue-600 hover:underline">Donabedian</a> would: what it has
          (structure), what it does (process) and what happens to its patients (outcomes), plus what its care costs and
          how it has changed. A few hospitals are featured below; search for any other.
        </p>
      </div>

      <nav className="flex flex-wrap items-center gap-1 border-b border-gray-200 pb-2" aria-label="Featured profiles">
        {FEATURED.map(f => (
          <a
            key={f.slug}
            href={href('profiles', f.slug)}
            aria-current={featured?.slug === f.slug ? 'page' : undefined}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${featured?.slug === f.slug ? 'bg-blue-50 text-blue-800' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {f.label}
          </a>
        ))}
        <HospitalPicker />
      </nav>

      {featured && featured.ids.length > 1 && <SystemProfile featured={featured} selected={member} />}
      {hospitalId && <HospitalProfile key={hospitalId} id={hospitalId} />}
    </main>
  )
}

// Search box that opens any hospital's profile.
function HospitalPicker() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<HospitalSummary[]>([])
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    const t = setTimeout(() => {
      axios.get<HospitalSummary[]>('/api/hospitals', { params: { q, limit: 8 } }).then(res => setResults(res.data)).catch(() => setResults([]))
    }, 250)
    return () => clearTimeout(t)
  }, [q])
  return (
    <div className="relative ml-auto">
      <input
        type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Profile another hospital…"
        aria-label="Profile another hospital" className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-56 bg-white"
      />
      {results.length > 0 && (
        <ul className="absolute right-0 z-20 mt-1 w-80 bg-white border border-gray-200 rounded-md shadow-sm text-sm max-h-72 overflow-y-auto">
          {results.map(h => (
            <li key={h.id}>
              <a href={href('profiles', h.id)} onClick={() => setQ('')} className="block px-3 py-2 hover:bg-gray-50">
                <span className="text-gray-900">{titleCase(h.name)}</span>
                <span className="text-xs text-gray-500"> {h.city ? titleCase(h.city) : ''}, {h.state}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- A system: its hospitals side by side ----------

const SYSTEM_SCOPES: Scope[] = ['overall', 'outcome', 'process', ...GROUPS]

function SystemProfile({ featured, selected }: { featured: Featured; selected?: string }) {
  const [rows, setRows] = useState<HospitalDetail[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    Promise.all(featured.ids.map(id => axios.get<HospitalDetail>(`/api/hospitals/${id}`).then(r => r.data)))
      .then(setRows).catch(() => setError(true))
  }, [featured])
  if (error) return <p className="text-red-500 text-sm">Couldn't load the system's hospitals.</p>
  if (!rows) return <p className="text-gray-400 text-sm">Loading {featured.title}…</p>

  const ranked = [...rows].sort((a, b) => (b.performance.overall?.score ?? -9) - (a.performance.overall?.score ?? -9))
  const scored = ranked.filter(r => r.performance.overall)
  const avg = (s: Scope) => {
    const v = rows.map(r => r.performance.scopes?.[s]?.score).filter((x): x is number => x !== undefined)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  const groupAvgs = GROUPS.map(g => ({ g, v: avg(g) })).filter(x => x.v !== null).sort((a, b) => b.v! - a.v!)
  const stars = rows.map(r => r.overallRating).filter((s): s is number => s !== null)

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-gray-800">{featured.title}</h3>
        {featured.blurb && <p className="text-sm text-gray-600 mt-1 max-w-3xl">{featured.blurb}</p>}
      </div>
      <div className="text-sm text-gray-700 bg-white border border-gray-200 rounded-lg p-4 space-y-1.5 leading-relaxed max-w-3xl">
        {scored.length > 0 && (
          <p>
            <strong>{titleCase(scored[0].name)}</strong> leads the system on the overall score ({formatScore(scored[0].performance.overall!.score)},
            #{scored[0].performance.overall!.nationalRank.toLocaleString('en-US')} nationally)
            {scored.length > 1 && <>; <strong>{titleCase(scored[scored.length - 1].name)}</strong> trails ({formatScore(scored[scored.length - 1].performance.overall!.score)})</>}.
          </p>
        )}
        {groupAvgs.length > 1 && (
          <p>
            Across its hospitals, the system is strongest on {SCOPE_INFO[groupAvgs[0].g].label.toLowerCase()} (average{' '}
            {formatScore(groupAvgs[0].v!)}) and weakest on {SCOPE_INFO[groupAvgs[groupAvgs.length - 1].g].label.toLowerCase()} ({formatScore(groupAvgs[groupAvgs.length - 1].v!)}).
          </p>
        )}
        {stars.length > 0 && (
          <p className="text-gray-500">
            CMS gives {stars.filter(s => s === 5).length} of its {rows.length} hospitals five stars; this site's scores compare each with what its
            patients and community predict, so the two can differ.
          </p>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left">Hospital</th>
              <th className="px-2 py-2 text-center" title="CMS overall star rating">CMS ★</th>
              {SYSTEM_SCOPES.map(s => (
                <th key={s} className="px-1.5 py-2 text-center font-medium" title={SCOPE_INFO[s].help}>{SCOPE_INFO[s].label.replace('Patient experience', 'Experience').replace('Timely & effective', 'Timely')}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ranked.map(h => (
              <tr key={h.id} className={selected === h.id ? 'bg-blue-50/60' : undefined}>
                <td className="px-3 py-2">
                  <a href={href('profiles', featured.slug, h.id)} className="font-medium text-blue-700 hover:underline">{titleCase(h.name)}</a>
                  <div className="text-xs text-gray-500">{h.city ? titleCase(h.city) : ''}</div>
                </td>
                <td className="px-2 py-2 text-center tabular-nums">{h.overallRating ?? '—'}</td>
                {SYSTEM_SCOPES.map(s => <ScoreCell key={s} score={h.performance.scopes?.[s]?.score} verdict={h.performance.scopes?.[s]?.verdict} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Scores compare each hospital with what its patients, community and peers predict, in units of the typical
        difference between hospitals (0 = as expected; blue = better, red = worse; a ring marks a clear case).
        {!selected && ' Pick a hospital for its full profile.'}
      </p>
    </section>
  )
}

function ScoreCell({ score, verdict }: { score?: number; verdict?: string }) {
  if (score === undefined) return <td className="px-1.5 py-2 text-center text-gray-300">—</td>
  const fill = divergingColor(Math.max(-1, Math.min(1, score / 1.5)))
  return (
    <td className="px-1.5 py-1.5 text-center">
      <span
        className={`inline-block min-w-[3.25rem] rounded px-1.5 py-1 text-xs tabular-nums ${verdict && verdict !== 'as_expected' ? 'ring-2 ring-offset-1 ring-gray-700' : ''}`}
        style={{ backgroundColor: fill, color: textOn(fill) }}
        title={verdict ? VERDICT_LABELS[verdict as keyof typeof VERDICT_LABELS].label : undefined}
      >
        {formatScore(score)}
      </span>
    </td>
  )
}

// ---------- One hospital in depth ----------

function HospitalProfile({ id }: { id: string }) {
  const [h, setH] = useState<HospitalDetail | null>(null)
  const [x, setX] = useState<ProfileExtras | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    Promise.all([
      axios.get<HospitalDetail>(`/api/hospitals/${encodeURIComponent(id)}`),
      axios.get<ProfileExtras>(`/api/hospitals/${encodeURIComponent(id)}/profile`),
    ])
      .then(([a, b]) => { setH(a.data); setX(b.data) })
      .catch(err => setError(err.response?.status === 404 ? 'No hospital with that CMS ID.' : "Couldn't load this profile."))
  }, [id])
  if (error) return <p className="text-red-500 text-sm">{error}</p>
  if (!h || !x) return <p className="text-gray-400 text-sm">Loading profile…</p>
  return <ProfileReport h={h} x={x} />
}

export function ProfileReport({ h, x }: { h: HospitalDetail; x: ProfileExtras }) {
  const p = h.performance
  const name = titleCase(h.name)
  const scopes = p.scopes ?? {}
  const measures = p.allMeasures ?? []
  const strengths = [...measures].filter(m => m.gapSd >= 0.3).sort((a, b) => b.gapSd - a.gapSd).slice(0, 4)
  const weaknesses = [...measures].filter(m => m.gapSd <= -0.3).sort((a, b) => a.gapSd - b.gapSd).slice(0, 4)
  const groups = GROUPS.filter(g => scopes[g]).sort((a, b) => scopes[b]!.score - scopes[a]!.score)
  const out = scopes.outcome
  const proc = scopes.process
  const siblings = x.system?.hospitals.filter(s => s.id !== h.id) ?? []
  const withHistory = CATEGORIES.map(c => ({ c, m: h.measures.find(m => m.category === c.id), points: h.history?.[c.id] ?? [] }))
    .filter(t => t.m && t.points.length > 1)

  return (
    <article className="space-y-6">
      <header className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-2xl font-semibold text-gray-900">{name}</h3>
          <a href={href('hospitals', h.id)} className="text-xs text-blue-600 hover:underline">Full hospital page →</a>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {[h.city && titleCase(h.city), h.state].filter(Boolean).join(', ')} · {h.hospitalType} · {h.ownership}
          {h.finance?.beds ? ` · ${h.finance.beds.toLocaleString('en-US')} beds` : ''}
        </p>
        <p className="text-sm text-gray-700 mt-2">
          {h.overallRating !== null && <>CMS star rating <strong>{h.overallRating} of 5</strong>. </>}
          {x.system && <>Part of <strong>{x.system.name}</strong>{siblings.length > 0 ? ` (${siblings.length + 1} hospitals)` : ''}. </>}
          {h.usNewsHonorRoll && 'On the U.S. News Honor Roll. '}
        </p>
      </header>

      <section className="space-y-3">
        <h4 className="text-lg font-semibold text-gray-800">In brief</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Overall, vs. expectations" value={p.overall ? formatScore(p.overall.score) : '—'}
            sub={p.overall ? `#${p.overall.nationalRank.toLocaleString('en-US')} of ${p.overall.nationalCount.toLocaleString('en-US')} · #${p.overall.stateRank} of ${p.overall.stateCount} in ${h.state}` : 'Too few measures'} />
          <Tile label="Outcomes" value={out ? formatScore(out.score) : '—'} sub={rankText(out, x.stateRanks.outcome, h.state ?? '')} />
          <Tile label="Process" value={proc ? formatScore(proc.score) : '—'} sub={rankText(proc, x.stateRanks.process, h.state ?? '')} />
          <Tile label="Medicare spending per patient" value={x.mspb ? x.mspb.value.toFixed(2) : '—'}
            sub={x.mspb ? `national median ${x.mspb.nationalMedian.toFixed(2)}` : 'Not reported'} />
        </div>
        <div className="text-sm text-gray-700 bg-white border border-gray-200 rounded-lg p-4 space-y-2 leading-relaxed">
          {p.overall ? (
            <p>
              After accounting for its patients, community and peers, {name} is{' '}
              <strong>{p.overall.verdict === 'as_expected' ? 'within the normal range' : VERDICT_LABELS[p.overall.verdict].label.toLowerCase()}</strong>{' '}
              overall, ranking in the {topShare(p.overall.nationalRank, p.overall.nationalCount)} nationally.
            </p>
          ) : <p>{name} has too few scored measure groups for an overall score.</p>}
          {out && proc && (
            <p>
              {Math.abs(out.score - proc.score) < 0.3
                ? `Its outcomes (${formatScore(out.score)}) and process (${formatScore(proc.score)}) are roughly level.`
                : out.score > proc.score
                  ? `Its outcomes (${formatScore(out.score)}) are stronger than its process (${formatScore(proc.score)}): patients fare better than the day-to-day care measures would suggest.`
                  : `Its process (${formatScore(proc.score)}) is stronger than its outcomes (${formatScore(out.score)}): the care measures look better than what happens to patients.`}
            </p>
          )}
          {groups.length > 1 && (
            <p>
              Strongest area: <strong>{SCOPE_INFO[groups[0]].label.toLowerCase()}</strong> ({formatScore(scopes[groups[0]]!.score)}). Weakest:{' '}
              <strong>{SCOPE_INFO[groups[groups.length - 1]].label.toLowerCase()}</strong> ({formatScore(scopes[groups[groups.length - 1]]!.score)}).
            </p>
          )}
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="font-semibold text-gray-800">Process and outcomes</h4>
        <ScopeBreakdown scopes={scopes} peer={p.peer ?? null} />
      </section>

      {(strengths.length > 0 || weaknesses.length > 0) && (
        <section className="grid md:grid-cols-2 gap-4">
          <StandOut title="Where it does best" tone="text-green-700" rows={strengths} empty="No measure is well above expectations." />
          <StandOut title="Where it falls short" tone="text-red-700" rows={weaknesses} empty="No measure is well below expectations." />
        </section>
      )}

      <section className="space-y-3">
        <h4 className="text-lg font-semibold text-gray-800">Structure: what it has to work with</h4>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ContextCard context={h.context} hospitalType={h.hospitalType} />
          <FinanceCard finance={h.finance} hospitalType={h.hospitalType} />
        </div>
        {(x.cost.costPerCase !== null || x.cost.salaryPerFte !== null) && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Spending per patient, adjusted for case mix" value={dollars(x.cost.costPerCase)} sub={`national median ${dollars(x.cost.nationalCostPerCase)}`} />
            <Tile label="Average pay per employee" value={dollars(x.cost.salaryPerFte)} sub={`national median ${dollars(x.cost.nationalSalaryPerFte)}`} />
            {x.mspb && (
              <Tile label={`Medicare spending vs. ${h.state}`} value={x.mspb.value.toFixed(2)}
                sub={x.mspb.stateMedian !== null ? `state median ${x.mspb.stateMedian.toFixed(2)}` : ''} />
            )}
          </div>
        )}
        {x.mspb && (
          <p className="text-xs text-gray-500">
            Medicare spending per patient covers 3 days before to 30 days after a stay, adjusted for prices and how sick
            patients are ({formatMonth(x.mspb.windowStart)} to {formatMonth(x.mspb.windowEnd)}); see{' '}
            <a href={href('finances')} className="text-blue-600 hover:underline">value</a> for how it relates to results.
          </p>
        )}
      </section>

      {withHistory.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-lg font-semibold text-gray-800">How it has changed</h4>
            <TrendLegend />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {withHistory.map(({ c, m, points }) => (
              <div key={c.id} className="bg-white border border-gray-200 rounded-lg p-3">
                <TrendChart label={c.label} points={points} unit={m!.unit} higherIsBetter={m!.higherIsBetter} />
              </div>
            ))}
          </div>
        </section>
      )}

      <AllMeasures measures={measures} />

      {siblings.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-lg p-4 text-sm">
          <h4 className="font-semibold text-gray-800">Other {x.system!.name} hospitals</h4>
          <p className="text-xs text-gray-500 mb-2">Health-system membership from AHRQ's Compendium of U.S. Health Systems (2023).</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {siblings.map(s => (
              <li key={s.id}>
                <a href={href('profiles', s.id)} className="text-blue-700 hover:underline">{titleCase(s.name)}</a>
                <span className="text-xs text-gray-400"> {s.city ? titleCase(s.city) : ''}, {s.state}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {h.notes.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="font-semibold text-gray-800">In the news</h4>
          <ul className="mt-2 space-y-2 text-sm text-gray-700">
            {h.notes.map(n => (
              <li key={n.url}>
                <span className="text-xs text-gray-500">{NOTE_KINDS[n.kind]} · </span>
                {n.summary}{' '}
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline whitespace-nowrap">
                  {n.source}, {formatMonth(n.published)} ↗
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}

const dollars = (v: number | null) => (v === null ? '—' : `$${Math.round(v).toLocaleString('en-US')}`)

function topShare(rank: number, of: number): string {
  const pct = (rank / of) * 100
  return pct <= 50 ? `top ${Math.max(1, Math.ceil(pct))}%` : `bottom ${Math.max(1, Math.ceil(100 - pct))}%`
}

function rankText(s: { nationalRank: number; nationalCount: number } | undefined, st: { stateRank: number; stateCount: number } | undefined, state: string) {
  if (!s) return 'Too few measures'
  return `#${s.nationalRank.toLocaleString('en-US')} of ${s.nationalCount.toLocaleString('en-US')}${st ? ` · #${st.stateRank} of ${st.stateCount} in ${state}` : ''}`
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-gray-900 tabular-nums mt-1">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{sub}</div>
    </div>
  )
}

function StandOut({ title, tone, rows, empty }: { title: string; tone: string; rows: HospitalQualityMeasure[]; empty: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm">
      <h4 className={`font-semibold ${tone}`}>{title}</h4>
      {rows.length === 0 ? <p className="text-gray-400 mt-2">{empty}</p> : (
        <ul className="mt-2 space-y-2">
          {rows.map(m => (
            <li key={m.measureId}>
              <div className="text-gray-900">{m.name.replace(/ \(HCAHPS\)$/, '').replace(/ star rating$/, '')}</div>
              <div className="text-xs text-gray-500">
                {formatValue(m.actual, m.unit)} vs. {formatValue(m.expected, m.unit)} expected · {formatScore(m.gapSd)}
                {m.verdict !== 'as_expected' && <span className="ml-1 font-medium">({m.verdict === 'better' ? 'clearly better' : 'clearly worse'})</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
