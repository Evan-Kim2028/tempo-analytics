// explorer/src/components/AddressDefiActivity.tsx
import type { AddressDefiStats } from '@/lib/defi'

const fmtCount = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

const fmtTimestamp = (ts: string) => {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function AddressDefiActivity({
  stats,
  address,
}: {
  stats: AddressDefiStats
  address: string
}) {
  const totalSwaps = stats.community_swaps + stats.protocol_swaps
  const hasActivity =
    stats.transfers_in + stats.transfers_out + totalSwaps + stats.lp_adds + stats.lp_removes > 0

  if (!hasActivity) return null

  return (
    <div className="mt-8">
      <h2 className="text-lg font-medium text-white mb-4">DeFi Activity</h2>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {(stats.transfers_in + stats.transfers_out) > 0 && (
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-4">
            <p className="text-tempo-muted text-xs mb-1">Token Transfers</p>
            <p className="text-xl font-semibold text-white">
              {fmtCount(stats.transfers_in + stats.transfers_out)}
            </p>
            <p className="text-tempo-muted text-xs mt-1">
              {fmtCount(stats.transfers_in)} in · {fmtCount(stats.transfers_out)} out
            </p>
          </div>
        )}
        {totalSwaps > 0 && (
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-4">
            <p className="text-tempo-muted text-xs mb-1">DEX Swaps</p>
            <p className="text-xl font-semibold text-white">{fmtCount(totalSwaps)}</p>
            <p className="text-tempo-muted text-xs mt-1">
              {stats.protocol_swaps > 0 && `${fmtCount(stats.protocol_swaps)} protocol`}
              {stats.protocol_swaps > 0 && stats.community_swaps > 0 && ' · '}
              {stats.community_swaps > 0 && `${fmtCount(stats.community_swaps)} community`}
            </p>
          </div>
        )}
        {(stats.lp_adds + stats.lp_removes) > 0 && (
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-4">
            <p className="text-tempo-muted text-xs mb-1">LP Activity</p>
            <p className="text-xl font-semibold text-white">
              {fmtCount(stats.lp_adds + stats.lp_removes)}
            </p>
            <p className="text-tempo-muted text-xs mt-1">
              {stats.lp_adds > 0 && `${fmtCount(stats.lp_adds)} adds`}
              {stats.lp_adds > 0 && stats.lp_removes > 0 && ' · '}
              {stats.lp_removes > 0 && `${fmtCount(stats.lp_removes)} removes`}
            </p>
          </div>
        )}
      </div>

      {/* Recent token transfers table */}
      {stats.recent_transfers.length > 0 && (
        <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-tempo-border">
            <h3 className="text-sm font-medium text-white">Recent Token Transfers</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-tempo-border">
                  <th className="text-left px-6 py-3 text-tempo-muted font-medium">Time</th>
                  <th className="text-left px-4 py-3 text-tempo-muted font-medium">Token</th>
                  <th className="text-left px-4 py-3 text-tempo-muted font-medium">Direction</th>
                  <th className="text-left px-6 py-3 text-tempo-muted font-medium">Counterparty</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent_transfers.map((t, i) => (
                  <tr key={`${t.hash}-${i}`} className="border-b border-tempo-border last:border-0 hover:bg-white/5 transition-colors">
                    <td className="px-6 py-3 text-tempo-muted text-xs">
                      {fmtTimestamp(t.block_timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <a href={`/address/${t.token}`} className="text-tempo-blue hover:underline font-medium">
                        {t.token_symbol}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${
                        t.direction === 'in'
                          ? 'bg-green-500/10 text-green-400 border-green-500/20'
                          : 'bg-red-500/10 text-red-400 border-red-500/20'
                      }`}>
                        {t.direction === 'in' ? '↓ in' : '↑ out'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <a href={`/address/${t.counterparty}`} className="font-mono text-xs text-tempo-blue hover:underline">
                        {t.counterparty.slice(0, 10)}…{t.counterparty.slice(-6)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
