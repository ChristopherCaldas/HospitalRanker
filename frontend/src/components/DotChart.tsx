import { useEffect, useRef, useState } from 'react'

const SURFACE = '#ffffff'

export interface DotSeries {
  name: string
  color: string
  values: (number | null)[]
  se?: (number | null)[] // drawn as a 95% range when given
}

// Dot-and-whisker chart over ordered categories (fifths), one or two series.
// Two series sit side by side in each slot, carry a legend and are labeled
// directly at the last slot. Drawn at measured pixel width; each slot is one
// hover/focus target with a tooltip listing every series.
export default function DotChart({ categories, series, format, zeroLabel, ariaLabel, height = 220 }: {
  categories: { label: string; sublabel?: string }[]
  series: DotSeries[]
  format: (v: number) => string
  zeroLabel?: string
  ariaLabel: string
  height?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(600)
  const [active, setActive] = useState<number | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  const H = height
  const labelRoom = series.length > 1 ? 96 : 16
  const M = { top: 16, right: labelRoom, bottom: 44, left: 52 }
  const ends = series.flatMap(s => s.values.flatMap((v, i) => {
    if (v === null) return []
    const half = 1.96 * (s.se?.[i] ?? 0)
    return [v - half, v + half]
  }))
  const lo = Math.min(0, ...ends)
  const hi = Math.max(0, ...ends)
  const pad = (hi - lo) * 0.1 || 0.1
  const y0 = lo - pad
  const y1 = hi + pad
  const slot = (W - M.left - M.right) / categories.length
  const offset = (k: number) => (series.length > 1 ? (k - (series.length - 1) / 2) * 12 : 0)
  const sx = (i: number, k = 0) => M.left + (i + 0.5) * slot + offset(k)
  const sy = (v: number) => H - M.bottom - ((v - y0) / (y1 - y0)) * (H - M.top - M.bottom)
  // Round steps (1, 2 or 5 x 10^k), four to six of them, always through 0.
  const raw = (y1 - y0) / 6
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw)!
  const ticks: number[] = []
  for (let t = Math.ceil(y0 / step) * step; t <= y1 + 1e-9; t += step) ticks.push(Number(t.toFixed(10)))
  const last = categories.length - 1

  return (
    <div ref={ref} className="relative mt-3">
      {series.length > 1 && (
        <div className="flex flex-wrap gap-4 text-xs text-gray-600 mb-1" aria-hidden="true">
          {series.map(s => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill={s.color} /></svg>
              {s.name}
            </span>
          ))}
        </div>
      )}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={ariaLabel}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke="#f0f1f3" />
            <text x={M.left - 8} y={sy(t) + 4} fontSize="11" fill="#6b7280" textAnchor="end">{t === 0 ? '0' : format(t)}</text>
          </g>
        ))}
        <line x1={M.left} x2={W - M.right} y1={sy(0)} y2={sy(0)} stroke="#9ca3af" />
        {zeroLabel && <text x={M.left + 4} y={sy(0) - 6} fontSize="11" fill="#6b7280">{zeroLabel}</text>}
        {categories.map((c, i) => (
          <g key={c.label}>
            <text x={sx(i)} y={H - M.bottom + 16} fontSize="11" fill="#374151" textAnchor="middle">{c.label}</text>
            {c.sublabel && <text x={sx(i)} y={H - M.bottom + 30} fontSize="10" fill="#9ca3af" textAnchor="middle">{c.sublabel}</text>}
          </g>
        ))}
        {series.map((s, k) => s.values.map((v, i) => {
          if (v === null) return null
          const se = s.se?.[i]
          return (
            <g key={`${s.name}-${i}`}>
              {se != null && <line x1={sx(i, k)} x2={sx(i, k)} y1={sy(v - 1.96 * se)} y2={sy(v + 1.96 * se)} stroke={s.color} strokeWidth={2} />}
              <circle cx={sx(i, k)} cy={sy(v)} r={5} fill={s.color} stroke={SURFACE} strokeWidth={2} />
            </g>
          )
        }))}
        {series.length > 1 && series.map((s, k) => {
          const v = s.values[last]
          return v === null ? null : (
            <text key={s.name} x={sx(last, k) + 10} y={sy(v) + 4} fontSize="11" fill="#374151">{s.name}</text>
          )
        })}
        {categories.map((c, i) => (
          <rect
            key={c.label} x={M.left + i * slot} y={M.top} width={slot} height={H - M.top - M.bottom}
            fill="transparent" tabIndex={0} aria-label={`${c.label}: ${series.map(s => `${s.name} ${s.values[i] === null ? 'none' : format(s.values[i]!)}`).join(', ')}`}
            onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)} onBlur={() => setActive(null)}
          />
        ))}
      </svg>
      {active !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-gray-200 bg-white px-2 py-1 text-xs shadow-sm whitespace-nowrap"
          style={{ left: Math.min(Math.max(sx(active) - 80, 0), W - 190), top: 8 }}
        >
          <div className="text-gray-500">{categories[active].label}{categories[active].sublabel ? ` (${categories[active].sublabel})` : ''}</div>
          {series.map(s => {
            const v = s.values[active]
            const se = s.se?.[active]
            return (
              <div key={s.name} className="text-gray-900">
                {series.length > 1 && <span className="text-gray-500">{s.name}: </span>}
                {v === null ? '—' : format(v)}{se != null && v !== null ? ` ±${(1.96 * se).toFixed(2)}` : ''}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
