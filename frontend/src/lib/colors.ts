// Chart color scales. Sequential = one hue light->dark (magnitude). Diverging =
// blue (better) <-> red (worse) around a gray midpoint, the red arm stepped to
// match the blue arm's OKLab lightness within 0.02 at every step.

export const INK = '#0b0b0b'

// Blue steps 100, 200, 300, 400, 500, 600, 700 of the reference ramp.
const SEQUENTIAL = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b']

const DIVERGING_GOOD = ['#9ec5f4', '#5598e7', '#256abf'] // mild -> strong
const DIVERGING_BAD = ['#f5b5b3', '#e5706e', '#bb3a39']
const MIDPOINT = '#f0efec'

// Tile/label text: ink while it clears 4.5:1 on the fill, white beyond.
const WHITE_TEXT = new Set(['#256abf', '#184f95', '#0d366b', '#bb3a39'])
export const textOn = (fill: string) => (WHITE_TEXT.has(fill) ? '#ffffff' : INK)

export function sequentialColor(value: number, min: number, max: number): string {
  if (max <= min) return SEQUENTIAL[3]
  const t = (value - min) / (max - min)
  return SEQUENTIAL[Math.min(SEQUENTIAL.length - 1, Math.max(0, Math.floor(t * SEQUENTIAL.length)))]
}

export const SEQUENTIAL_STEPS = SEQUENTIAL

// `goodness` in [-1, 1]: positive = better than the reference. |goodness| is
// binned into midpoint (< 1/7) and three steps per arm.
export function divergingColor(goodness: number): string {
  const step = Math.min(3, Math.floor(Math.abs(goodness) * 3.5 + 0.5))
  if (step === 0) return MIDPOINT
  return (goodness > 0 ? DIVERGING_GOOD : DIVERGING_BAD)[step - 1]
}

export const DIVERGING_STEPS = [...[...DIVERGING_BAD].reverse(), MIDPOINT, ...DIVERGING_GOOD]
