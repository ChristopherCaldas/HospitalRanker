import type { Hospital } from '../types'

interface Props {
  hospitals: Hospital[]
  rank: 'top' | 'bottom'
}

export default function RankingTable({ hospitals, rank }: Props) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
          <tr>
            <th className="px-4 py-2 text-left">#</th>
            <th className="px-4 py-2 text-left">Hospital</th>
            <th className="px-4 py-2 text-left">Location</th>
            <th className="px-4 py-2 text-right">Score</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {hospitals.map((h, i) => (
            <tr key={h.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-gray-400">{i + 1}</td>
              <td className="px-4 py-3 font-medium text-gray-800">{h.name}</td>
              <td className="px-4 py-3 text-gray-500">
                {h.city}, {h.state}
              </td>
              <td className="px-4 py-3 text-right font-mono text-gray-700">
                {h.score ?? 'N/A'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
