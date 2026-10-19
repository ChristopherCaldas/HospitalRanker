import { useState, type ReactNode } from 'react'
import { textOn } from '../lib/colors'

// Equal-area tile grid: every state is one tile, because every state is one
// data point in the analysis; a geographic map would let Texas and Montana
// dominate the picture. [column, row] on an 11 x 8 grid.
const TILES: Record<string, [number, number]> = {
  AK: [0, 0], ME: [10, 0],
  VT: [9, 1], NH: [10, 1],
  WA: [0, 2], ID: [1, 2], MT: [2, 2], ND: [3, 2], MN: [4, 2], IL: [5, 2], WI: [6, 2], MI: [7, 2], NY: [8, 2], RI: [9, 2], MA: [10, 2],
  OR: [0, 3], NV: [1, 3], WY: [2, 3], SD: [3, 3], IA: [4, 3], IN: [5, 3], OH: [6, 3], PA: [7, 3], NJ: [8, 3], CT: [9, 3],
  CA: [0, 4], UT: [1, 4], CO: [2, 4], NE: [3, 4], MO: [4, 4], KY: [5, 4], WV: [6, 4], VA: [7, 4], MD: [8, 4], DE: [9, 4],
  AZ: [1, 5], NM: [2, 5], KS: [3, 5], AR: [4, 5], TN: [5, 5], NC: [6, 5], SC: [7, 5], DC: [8, 5],
  OK: [3, 6], LA: [4, 6], MS: [5, 6], AL: [6, 6], GA: [7, 6],
  HI: [0, 7], TX: [3, 7], FL: [8, 7],
}

export interface Tile {
  state: string
  fill: string | null // null = no data
}

interface Props {
  tiles: Tile[]
  highlight: string | null
  onHighlight: (state: string | null) => void
  tooltip: (state: string) => ReactNode
  legend: ReactNode
  label: string
}

export default function TileMap({ tiles, highlight, onHighlight, tooltip, legend, label }: Props) {
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const byState = new Map(tiles.map(t => [t.state, t]))

  return (
    <figure className="relative" aria-label={label}>
      <div
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: 'repeat(11, minmax(0, 1fr))' }}
        onPointerLeave={() => {
          onHighlight(null)
          setPointer(null)
        }}
      >
        {Object.entries(TILES).map(([state, [col, row]]) => {
          const fill = byState.get(state)?.fill ?? null
          const active = highlight === state
          return (
            <button
              key={state}
              type="button"
              aria-label={state}
              style={{
                gridColumnStart: col + 1,
                gridRowStart: row + 1,
                backgroundColor: fill ?? 'transparent',
                color: fill ? textOn(fill) : '#898781',
                outline: active ? '2px solid #0b0b0b' : undefined,
                outlineOffset: active ? '1px' : undefined,
              }}
              className={`aspect-square rounded-[4px] text-[11px] sm:text-xs font-semibold flex items-center justify-center
                ${fill ? '' : 'border border-gray-200'} focus:outline-none`}
              onPointerMove={e => {
                const box = e.currentTarget.closest('figure')!.getBoundingClientRect()
                setPointer({ x: e.clientX - box.left, y: e.clientY - box.top })
                onHighlight(state)
              }}
              onFocus={e => {
                const box = e.currentTarget.closest('figure')!.getBoundingClientRect()
                const tile = e.currentTarget.getBoundingClientRect()
                setPointer({ x: tile.right - box.left, y: tile.top - box.top })
                onHighlight(state)
              }}
              onBlur={() => onHighlight(null)}
            >
              {state}
            </button>
          )
        })}
      </div>

      {highlight && pointer && TILES[highlight] && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 bg-white border border-gray-200 shadow-md rounded-md px-3 py-2 text-xs w-56"
          style={{
            left: pointer.x + 12,
            top: pointer.y + 12,
            transform: pointer.x > 300 ? 'translateX(calc(-100% - 24px))' : undefined,
          }}
        >
          {tooltip(highlight)}
        </div>
      )}

      <figcaption className="mt-3">{legend}</figcaption>
    </figure>
  )
}
