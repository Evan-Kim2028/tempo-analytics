import type { ReactNode } from 'react'
import type {
  DailyBridgeProviderAssetFlow,
  DailyBridgeProviderFlow,
} from '@/lib/bridges'

interface BridgeFlowTableProps {
  providerFlows: DailyBridgeProviderFlow[]
  providerAssetFlows: DailyBridgeProviderAssetFlow[]
}

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
})

const countFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

function fmtUSD(value: number) {
  return usdFormatter.format(value)
}

function fmtCount(value: number) {
  return countFormatter.format(value)
}

function TableShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-tempo-border">
        <h2 className="text-base font-medium text-white">{title}</h2>
        {subtitle && <p className="text-tempo-muted text-xs mt-1">{subtitle}</p>}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-6 py-8 text-center text-tempo-muted text-sm">
        No bridge flows found for the selected period.
      </td>
    </tr>
  )
}

export function BridgeFlowTable({ providerFlows, providerAssetFlows }: BridgeFlowTableProps) {
  return (
    <div className="space-y-8">
      <TableShell title="Provider Daily Rows" subtitle="All provider rollups for the last 30 days.">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-tempo-border">
              <th className="text-left px-6 py-3 text-tempo-muted font-normal">Day</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal">Provider</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">Inflow</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">Outflow</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">Net</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">Txs</th>
              <th className="text-right px-6 py-3 text-tempo-muted font-normal">Users</th>
            </tr>
          </thead>
          <tbody>
            {providerFlows.map(row => (
              <tr key={`${row.day}:${row.provider}`} className="border-b border-tempo-border hover:bg-tempo-border/30 transition-colors">
                <td className="px-6 py-4 text-tempo-muted font-mono text-xs">{row.day}</td>
                <td className="px-4 py-4">
                  <span className="text-white font-medium">{row.provider_label}</span>
                  <span className="text-tempo-muted ml-2 text-xs font-mono">{row.provider}</span>
                </td>
                <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(row.gross_inflow)}</td>
                <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(row.gross_outflow)}</td>
                <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(row.net_flow)}</td>
                <td className="text-right px-4 py-4 text-tempo-muted font-mono">{fmtCount(row.tx_count)}</td>
                <td className="text-right px-6 py-4 text-tempo-muted font-mono">{fmtCount(row.unique_users)}</td>
              </tr>
            ))}
            {providerFlows.length === 0 && <EmptyRow colSpan={7} />}
          </tbody>
        </table>
      </TableShell>

      <TableShell title="Provider Asset Rollups" subtitle="Bridge provider rows grouped by asset.">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-tempo-border">
              <th className="text-left px-6 py-3 text-tempo-muted font-normal">Day</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal">Provider</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal">Asset</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">Inflow</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">Outflow</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">Net</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">Txs</th>
              <th className="text-right px-6 py-3 text-tempo-muted font-normal">Users</th>
            </tr>
          </thead>
          <tbody>
            {providerAssetFlows.map(row => (
              <tr key={`${row.day}:${row.provider}:${row.token}`} className="border-b border-tempo-border hover:bg-tempo-border/30 transition-colors">
                <td className="px-6 py-4 text-tempo-muted font-mono text-xs">{row.day}</td>
                <td className="px-4 py-4">
                  <span className="text-white font-medium">{row.provider_label}</span>
                  <span className="text-tempo-muted ml-2 text-xs font-mono">{row.provider}</span>
                </td>
                <td className="px-4 py-4 text-white font-medium">{row.asset}</td>
                <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(row.gross_inflow)}</td>
                <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(row.gross_outflow)}</td>
                <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(row.net_flow)}</td>
                <td className="text-right px-4 py-4 text-tempo-muted font-mono">{fmtCount(row.tx_count)}</td>
                <td className="text-right px-6 py-4 text-tempo-muted font-mono">{fmtCount(row.unique_users)}</td>
              </tr>
            ))}
            {providerAssetFlows.length === 0 && <EmptyRow colSpan={8} />}
          </tbody>
        </table>
      </TableShell>
    </div>
  )
}
