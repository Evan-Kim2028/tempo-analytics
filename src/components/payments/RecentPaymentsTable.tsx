import type { PaymentRow } from '@/lib/payments'
import { CopyableHash } from '@/components/CopyableHash'

const amountFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

function shortenAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export function RecentPaymentsTable({ rows }: { rows: PaymentRow[] }) {
  return (
    <section className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-tempo-border">
        <h2 className="text-lg font-medium text-white">Recent Payments</h2>
        <p className="text-xs text-tempo-muted mt-1">Successful and failed memo-bearing payments in one feed.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-tempo-border">
              <th className="text-left px-6 py-3 text-tempo-muted font-normal">Timestamp</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal">Status</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal">Tx Hash</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal">Sender</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal">Recipient</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal">Token</th>
              <th className="text-right px-4 py-3 text-tempo-muted font-normal">Amount</th>
              <th className="text-left px-4 py-3 text-tempo-muted font-normal">Memo</th>
              <th className="text-left px-6 py-3 text-tempo-muted font-normal">Family</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.tx_hash} className="border-b border-tempo-border hover:bg-tempo-border/30 transition-colors">
                <td className="px-6 py-4 text-xs font-mono text-tempo-muted">{row.timestamp}</td>
                <td className="px-4 py-4">
                  <span className={row.status === 'success' ? 'text-emerald-400' : 'text-amber-300'}>
                    {row.status}
                  </span>
                </td>
                <td className="px-4 py-4"><CopyableHash hash={row.tx_hash} display={shortenAddress(row.tx_hash)} /></td>
                <td className="px-4 py-4 text-xs font-mono"><a href={`/address/${row.sender}`} className="text-tempo-blue hover:underline">{shortenAddress(row.sender)}</a></td>
                <td className="px-4 py-4 text-xs font-mono"><a href={`/address/${row.recipient}`} className="text-tempo-blue hover:underline">{shortenAddress(row.recipient)}</a></td>
                <td className="px-4 py-4 text-white">{row.token_label}</td>
                <td className="px-4 py-4 text-right font-mono text-white">{amountFormatter.format(row.amount)}</td>
                <td className="px-4 py-4 text-white">{row.memo_text ?? (row.memo_kind === 'opaque' ? 'Opaque memo' : 'Empty memo')}</td>
                <td className="px-6 py-4 text-xs text-tempo-muted">{row.memo_family ?? '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-sm text-tempo-muted">
                  No memo-bearing payments found for the selected period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
