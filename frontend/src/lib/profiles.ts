// Featured hospital profiles, each a tab on the Profiles page. A feature with
// several hospitals is shown as a system comparison first.
export interface Featured {
  slug: string
  label: string
  title: string
  ids: string[]
  blurb?: string
}

export const FEATURED: Featured[] = [
  { slug: 'christiana', label: 'Christiana', title: 'Christiana Hospital', ids: ['080001'] },
  { slug: 'washington-hospital-center', label: 'Washington Hospital Center', title: 'MedStar Washington Hospital Center', ids: ['090011'] },
  {
    slug: 'catholic-health',
    label: 'Catholic Health (Long Island)',
    title: 'Catholic Health, Long Island',
    ids: ['330182', '330286', '330259', '330401', '330246', '330332'],
    blurb: "Long Island's Catholic health system (formerly Catholic Health Services of Long Island): six acute care hospitals across Nassau and Suffolk counties.",
  },
  { slug: 'putnam', label: 'Putnam', title: 'Putnam Hospital Center', ids: ['330273'] },
]

export const featuredBySlug = (slug: string | undefined) => FEATURED.find(f => f.slug === slug)

// CMS's all-caps names, made readable: "ST FRANCIS HOSPITAL - THE HEART CENTER"
// -> "St Francis Hospital - The Heart Center". Short words stay lower case
// except at the start of a name or after a dash.
const SMALL = new Set(['of', 'and', 'the', 'at', 'for', 'in', 'on'])
const KEEP = new Set(['CHSLI', 'NYU', 'UPMC', 'VA', 'II', 'III', 'LLC'])
const BRANDS: Record<string, string> = { medstar: 'MedStar', christianacare: 'ChristianaCare', healthalliance: 'HealthAlliance' }
export function titleCase(name: string): string {
  return name.toLowerCase().split(' ').map((w, i, words) => {
    if (KEEP.has(w.toUpperCase())) return w.toUpperCase()
    if (BRANDS[w]) return BRANDS[w]
    if (i > 0 && words[i - 1] !== '-' && SMALL.has(w)) return w
    return w.replace(/(^|[-(/])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase())
  }).join(' ')
}
