import type { TopSponsorRow } from '@/lib/tempoAnalytics'

export function TopSponsorsTable({ data }: { data: TopSponsorRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-tempo-border">
            <th className="text-left px-4 py-3 text-tempo-muted font-medium">Sponsor</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-medium">Sponsored Txs</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-medium hidden md:table-cell">Unique Users</th>
            <th className="text-left px-4 py-3 text-tempo-muted font-medium">Last Seen</th>
          </tr>
        </thead>
        <tbody>
          {data.map(row => (
            <tr key={row.sponsor} className="border-b border-tempo-border last:border-0 hover:bg-white/5 transition-colors">
              <td className="px-4 py-3 font-mono text-xs text-white">{row.sponsor}</td>
              <td className="px-4 py-3 font-mono text-xs text-tempo-muted">{row.sponsored_txs.toLocaleString()}</td>
              <td className="px-4 py-3 font-mono text-xs text-tempo-muted hidden md:table-cell">{row.unique_users_sponsored.toLocaleString()}</td>
              <td className="px-4 py-3 font-mono text-xs text-tempo-muted">{row.last_seen.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
