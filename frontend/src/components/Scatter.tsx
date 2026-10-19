import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface Point {
  id: string
  x: number
  y: number
}

interface Props {
  points: Point[]
  fit: { slope: number; intercept: number } | null
  xLabel: string
  yLabel: string
  formatX: (v: number) => string
  formatY: (v: number) => string
  highlight: string | null
  onHighlight: (id: string | null) => void
  tooltip: (id: string) => ReactNode
  label: string
}

const M = { top: 16, right: 20, bottom: 48, left: 64 }
const SERIES = '#2a78d6'
const SURFACE = '#ffffff'

// ~5 round ticks covering [min, max].
function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || Math.abs(max) || 1
  const raw = span / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= raw) ?? raw
  const ticks: number[] = []
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) ticks.push(Number(t.toPrecision(12)))
  return ticks
}

export default function Scatter({ points, fit, xLabel, yLabel, formatX, formatY, highlight, onHighlight, tooltip, label }: Props) {
  const [focusId, setFocusId] = useState<string | null>(null)
  // Drawn at the container's real pixel width (not a scaled viewBox) so text
  // and marks keep their specified sizes in narrow cards.
  const ref = useRef<HTMLElement>(null)
  const [W, setW] = useState(480)
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const H = Math.round(Math.min(380, Math.max(260, W * 0.7)))

  if (points.length === 0) return <p className="text-sm text-gray-400">No data.</p>

  const pad = (lo: number, hi: number) => {
    const d = (hi - lo || 1) * 0.06
    return [lo - d, hi + d] as const
  }
  const [x0, x1] = pad(Math.min(...points.map(p => p.x)), Math.max(...points.map(p => p.x)))
  const [y0, y1] = pad(Math.min(...points.map(p => p.y)), Math.max(...points.map(p => p.y)))
  const sx = (v: number) => M.left + ((v - x0) / (x1 - x0)) * (W - M.left - M.right)
  const sy = (v: number) => H - M.bottom - ((v - y0) / (y1 - y0)) * (H - M.top - M.bottom)
  const xTicks = niceTicks(x0, x1).filter(t => t >= x0 && t <= x1)
  const yTicks = niceTicks(y0, y1).filter(t => t >= y0 && t <= y1)

  // Label only the three states furthest from the trend (or from the mean),
  // skipping any whose label would land on one already placed.
  const predicted = (p: Point) => (fit ? fit.intercept + fit.slope * p.x : points.reduce((a, q) => a + q.y, 0) / points.length)
  const labelled = new Set<string>()
  const placed: Point[] = []
  for (const p of [...points].sort((a, b) => Math.abs(b.y - predicted(b)) - Math.abs(a.y - predicted(a)))) {
    if (placed.length === 3) break
    if (placed.some(q => Math.abs(sx(q.x) - sx(p.x)) < 30 && Math.abs(sy(q.y) - sy(p.y)) < 14)) continue
    placed.push(p)
    labelled.add(p.id)
  }
  const active = highlight ?? focusId
  const activePoint = points.find(p => p.id === active)

  return (
    <figure ref={ref} className="relative" aria-label={label}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={label}>
        {yTicks.map(t => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke="#e1e0d9" strokeWidth={1} />
            <text x={M.left - 8} y={sy(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="#898781" className="tabular-nums">
              {formatY(t)}
            </text>
          </g>
        ))}
        <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="#c3c2b7" strokeWidth={1} />
        {xTicks.map(t => (
          <text key={`x${t}`} x={sx(t)} y={H - M.bottom + 18} textAnchor="middle" fontSize={11} fill="#898781" className="tabular-nums">
            {formatX(t)}
          </text>
        ))}
        <text x={(M.left + W - M.right) / 2} y={H - 8} textAnchor="middle" fontSize={12} fill="#52514e">{xLabel}</text>
        <text transform={`translate(14 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} fill="#52514e">
          {yLabel}
        </text>

        {fit && (
          <line
            x1={sx(x0)} y1={sy(fit.intercept + fit.slope * x0)}
            x2={sx(x1)} y2={sy(fit.intercept + fit.slope * x1)}
            stroke="#898781" strokeWidth={2} strokeLinecap="round"
            clipPath="url(#plot-clip)"
          />
        )}
        <clipPath id="plot-clip">
          <rect x={M.left} y={M.top} width={W - M.left - M.right} height={H - M.top - M.bottom} />
        </clipPath>

        {points.map(p => (
          <g key={p.id}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={p.id === active ? 6 : 4}
              fill={SERIES} stroke={p.id === active ? '#0b0b0b' : SURFACE} strokeWidth={2} />
            {labelled.has(p.id) && p.id !== active && (
              <text x={sx(p.x) + 8} y={sy(p.y)} dy="0.32em" fontSize={11} fill="#52514e">{p.id}</text>
            )}
          </g>
        ))}

        {/* Hit targets: 24px, larger than the 8px dots. */}
        {points.map(p => (
          <circle
            key={`hit-${p.id}`}
            cx={sx(p.x)} cy={sy(p.y)} r={12}
            fill="transparent"
            tabIndex={0}
            aria-label={`${p.id}: ${formatX(p.x)}, ${formatY(p.y)}`}
            onPointerEnter={() => onHighlight(p.id)}
            onPointerLeave={() => onHighlight(null)}
            onFocus={() => setFocusId(p.id)}
            onBlur={() => setFocusId(null)}
            className="cursor-default focus:outline-none"
          />
        ))}
      </svg>

      {activePoint && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 bg-white border border-gray-200 shadow-md rounded-md px-3 py-2 text-xs w-56"
          style={{
            left: `${(sx(activePoint.x) / W) * 100}%`,
            top: `${(sy(activePoint.y) / H) * 100}%`,
            transform: sx(activePoint.x) > W / 2 ? 'translate(calc(-100% - 14px), -50%)' : 'translate(14px, -50%)',
          }}
        >
          {tooltip(activePoint.id)}
        </div>
      )}
    </figure>
  )
}
