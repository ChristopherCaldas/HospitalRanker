import type { ReactNode } from 'react'

// A collapsible "how to read this" glossary. Open by default for first-time
// readers; experienced readers collapse it once.
export default function HowToRead({ title = 'How to read these numbers', items, open = false }: {
  title?: string
  items: { term: string; text: ReactNode }[]
  open?: boolean
}) {
  return (
    <details open={open} className="bg-white border border-gray-200 rounded-lg text-sm group">
      <summary className="px-4 py-3 font-semibold text-gray-700 cursor-pointer select-none">
        <span className="text-blue-600 mr-1" aria-hidden="true">ⓘ</span>
        {title}
      </summary>
      <dl className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-2">
        {items.map(item => (
          <div key={item.term} className="contents">
            <dt className="font-medium text-gray-800">{item.term}</dt>
            <dd className="text-gray-600 leading-relaxed">{item.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
