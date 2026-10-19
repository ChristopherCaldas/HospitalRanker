import type { Category } from '../types'

interface Props {
  categories: { id: Category; label: string }[]
  active: Category
  hrefFor: (cat: Category) => string
}

export default function TabNav({ categories, active, hrefFor }: Props) {
  return (
    <nav className="bg-white border-b border-gray-200 px-6">
      <div className="max-w-5xl mx-auto flex gap-1 overflow-x-auto">
        {categories.map(cat => (
          <a
            key={cat.id}
            href={hrefFor(cat.id)}
            aria-current={active === cat.id ? 'page' : undefined}
            className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              active === cat.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {cat.label}
          </a>
        ))}
      </div>
    </nav>
  )
}
