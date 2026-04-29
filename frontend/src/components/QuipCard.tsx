interface Props {
  quip: string
  type: 'best' | 'worst'
}

export default function QuipCard({ quip, type }: Props) {
  return (
    <div
      className={`rounded-lg px-4 py-3 text-sm italic mb-3 ${
        type === 'best'
          ? 'bg-green-50 text-green-700 border border-green-100'
          : 'bg-red-50 text-red-700 border border-red-100'
      }`}
    >
      "{quip}"
    </div>
  )
}
