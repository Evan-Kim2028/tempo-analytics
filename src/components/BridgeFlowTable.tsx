import type { RecentBridgeEvent } from '@/lib/bridges'
import { CopyableHash } from '@/components/CopyableHash'

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
})

export function BridgeFlowTable({ events }: { events: RecentBridgeEvent[] }) {
  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-tempo-border">
        <h2 className="text-base font-medium text-white">Recent Bridge Mints &amp; Burns</h2>
        <p className="text-tempo-muted text-xs mt-1">Most recent user-facing inflows and outflows across all bridge providers.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-tempo-border">
              <th className="text-left px-6 py-3 text-tempo-muted font-normal text-xs">Day</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal text-xs">Provider</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal text-xs">Direction</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal text-xs">Asset</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal text-xs">Amount</th>
              <th className="text-right px-6 py-3 text-tempo-muted font-normal text-xs">Tx Hash</th>
            </tr>
          </thead>
          <tbody>
            {events.map(row => (
              <tr key={row.tx_hash} className="border-b border-tempo-border last:border-0 hover:bg-tempo-border/30 transition-colors">
                <td className="px-6 py-3 text-tempo-muted font-mono text-xs">{row.day}</td>
                <td className="px-4 py-3 text-white text-sm">{row.provider_label}</td>
                <td className="px-4 py-3 text-sm">
                  <span className={row.direction === 'inflow' ? 'text-green-400' : 'text-amber-400'}>
                    {row.direction === 'inflow' ? 'Mint' : 'Burn'}
                  </span>
                </td>
                <td className="px-4 py-3 text-white text-sm">{row.asset}</td>
                <td className="px-4 py-3 text-right text-white font-mono tabular-nums text-sm">
                  {usdFormatter.format(row.amount)}
                </td>
                <td className="px-6 py-3 text-right">
                  <CopyableHash hash={row.tx_hash} />
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-tempo-muted text-sm">
                  No bridge events found for the selected period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
