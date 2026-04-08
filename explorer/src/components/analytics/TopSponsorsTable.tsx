import type { TopSponsorRow } from '@/lib/tempoAnalytics'

function formatTimestamp(value: string): string {
  return new Date(value).toISOString().replace('T', ' ').slice(0, 16)
}

export function TopSponsorsTable({ data }: { data: TopSponsorRow[] }) {
  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-x-auto">
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
              <td className="px-4 py-3 font-mono text-xs text-tempo-muted">{formatTimestamp(row.last_seen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
