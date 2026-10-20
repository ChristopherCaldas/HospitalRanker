import { useEffect, useRef, useState } from 'react'
import type { HistoryPoint } from '../types'
import { formatMonth, formatValue } from '../lib/format'

// Small-multiple trend: one hospital's yearly scores on a measure (solid blue)
// against the national median for the same periods (dashed gray). Two series,
// so the section around it carries a legend (TrendLegend).

const SERIES = '#2a78d6'
const MEDIAN = '#8a919c'
const SURFACE = '#ffffff'
const M = { top: 8, right: 8, bottom: 18, left: 8 }
const H = 84
const MIN_SPAN: Record<string, number> = { minutes: 60, percent: 5, ratio: 0.6 }

const year = (iso: string) => iso.slice(0, 4)

export function TrendLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600" aria-hidden="true">
      <span className="inline-flex items-center gap-1.5">
        <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke={SERIES} strokeWidth="2" /></svg>
        This hospital
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke={MEDIAN} strokeWidth="1.5" strokeDasharray="3 3" /></svg>
        National median
      </span>
    </div>
  )
}

export default function TrendChart({ label, points, unit, higherIsBetter }: {
  label: string
  points: HistoryPoint[]
  unit: string
  higherIsBetter: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(160)
  const [active, setActive] = useState<number | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setW(Math.max(120, Math.round(entry.contentRect.width))))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  const last = points[points.length - 1]
  const summary = points.length
    ? `${label}: ${formatValue(points[0].score, unit)} in ${year(points[0].end)} to ${formatValue(last.score, unit)} in ${year(last.end)}; national median ${formatValue(last.nationalMedian, unit)}. ${higherIsBetter ? 'Higher' : 'Lower'} is better.`
    : `${label}: no history`

  const values = points.flatMap(p => (p.nationalMedian === null ? [p.score] : [p.score, p.nationalMedian]))
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  // Each chart scales to its own data, so a floor on the visible range keeps
  // small wobbles (a 1-point mortality change, one star) from filling it.
  const minSpan = MIN_SPAN[unit] ?? 0
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2
    ;[lo, hi] = [mid - minSpan / 2, mid + minSpan / 2]
  }
  if (unit === 'stars') [lo, hi] = [1, 5]
  const padY = (hi - lo || Math.abs(hi) || 1) * 0.12
  const [y0, y1] = [lo - padY, hi + padY]
  // Measurement periods overlap and are uneven, so points are spaced by order.
  const sx = (i: number) => M.left + (points.length === 1 ? 0.5 : i / (points.length - 1)) * (W - M.left - M.right)
  const sy = (v: number) => H - M.bottom - ((v - y0) / (y1 - y0)) * (H - M.top - M.bottom)
  const path = (get: (p: HistoryPoint) => number | null) =>
    points
      .map((p, i) => [i, get(p)] as const)
      .filter((d): d is readonly [number, number] => d[1] !== null)
      .map(([i, v], k) => `${k ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`)
      .join('')

  const shown = active === null ? null : points[active]
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const i = active ?? points.length - 1
    setActive(Math.min(points.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1))))
  }

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-gray-700 truncate">{label}</span>
        {last && <span className="text-xs tabular-nums text-gray-900">{formatValue(last.score, unit)}</span>}
      </div>
      <div className="text-[11px] text-gray-400">{higherIsBetter ? 'higher is better' : 'lower is better'}</div>
      <div
        ref={ref}
        className="relative mt-1 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        tabIndex={points.length ? 0 : -1}
        role="img"
        aria-label={summary}
        onKeyDown={onKey}
        onFocus={() => setActive(points.length - 1)}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
      >
        {points.length === 0 ? (
          <p className="text-xs text-gray-400 py-6">No history</p>
        ) : (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" aria-hidden="true">
            <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="#e5e7eb" />
            <path d={path(p => p.nationalMedian)} fill="none" stroke={MEDIAN} strokeWidth={1.5} strokeDasharray="3 3" />
            <path d={path(p => p.score)} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {shown && <line x1={sx(active!)} x2={sx(active!)} y1={M.top} y2={H - M.bottom} stroke="#d1d5db" />}
            {(shown ? [active!] : [points.length - 1]).map(i => (
              <circle key={i} cx={sx(i)} cy={sy(points[i].score)} r={4} fill={SERIES} stroke={SURFACE} strokeWidth={2} />
            ))}
            <text x={M.left} y={H - 4} fontSize="10" fill="#6b7280">{year(points[0].end)}</text>
            {points.length > 1 && (
              <text x={W - M.right} y={H - 4} fontSize="10" fill="#6b7280" textAnchor="end">{year(last.end)}</text>
            )}
            {/* Hit columns wider than the marks */}
            {points.map((_, i) => {
              const half = points.length === 1 ? W / 2 : (W - M.left - M.right) / (points.length - 1) / 2
              return (
                <rect key={i} x={sx(i) - half} y={0} width={half * 2} height={H} fill="transparent" onMouseEnter={() => setActive(i)} />
              )
            })}
          </svg>
        )}
        {shown && (
          <div
            className="pointer-events-none absolute z-10 -top-2 -translate-y-full rounded border border-gray-200 bg-white px-2 py-1 text-[11px] leading-snug shadow-sm whitespace-nowrap"
            style={{ left: Math.min(Math.max(sx(active!) - 70, 0), Math.max(0, W - 140)) }}
          >
            <div className="text-gray-500">
              {shown.start ? `${formatMonth(shown.start)} – ` : ''}{formatMonth(shown.end)}
            </div>
            <div className="text-gray-900">This hospital: {formatValue(shown.score, unit)}</div>
            <div className="text-gray-600">National median: {formatValue(shown.nationalMedian, unit)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
