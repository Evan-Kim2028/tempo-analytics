import type { ReactNode } from 'react'
import type { PaymentCounterpartyRow, PaymentsDailyPoint } from '@/lib/payments'
import { PaymentsAmountChart } from '@/components/charts/PaymentsAmountChart'
import { PaymentsCountChart } from '@/components/charts/PaymentsCountChart'
import { PaymentsMemoPatternChart } from '@/components/charts/PaymentsMemoPatternChart'

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-tempo-card border border-tempo-border rounded-lg p-5">
      <h2 className="text-lg font-medium text-white mb-4">{title}</h2>
      {children}
    </section>
  )
}

function CounterpartyList({ title, rows }: { title: string; rows: PaymentCounterpartyRow[] }) {
  return (
    <section className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-tempo-border">
        <h2 className="text-base font-medium text-white">{title}</h2>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-tempo-border">
            <th className="text-left px-5 py-2 text-tempo-muted font-normal text-xs">Address</th>
            <th className="text-right px-4 py-2 text-tempo-muted font-normal text-xs">Payments</th>
            <th className="text-right px-5 py-2 text-tempo-muted font-normal text-xs">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.address} className="border-b border-tempo-border last:border-0 hover:bg-tempo-border/30 transition-colors">
              <td className="px-5 py-3 font-mono text-xs text-white max-w-0 w-full">
                <a href={`/address/${row.address}`} className="block truncate hover:underline" title={row.address}>
                  {row.address.slice(0, 8)}…{row.address.slice(-6)}
                </a>
              </td>
              <td className="px-4 py-3 text-right text-tempo-muted tabular-nums whitespace-nowrap">{row.payment_count.toLocaleString()}</td>
              <td className="px-5 py-3 text-right text-white tabular-nums whitespace-nowrap">${row.total_amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="px-5 py-6 text-center text-xs text-tempo-muted">No data</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

export function PaymentsNarrative({
  daily,
  topRecipientsByAmount,
  topRecipientsByCount,
  topSenders,
}: {
  daily: PaymentsDailyPoint[]
  topRecipientsByAmount: PaymentCounterpartyRow[]
  topRecipientsByCount: PaymentCounterpartyRow[]
  topSenders: PaymentCounterpartyRow[]
}) {
  return (
    <div className="space-y-6">
      <ChartCard title="Daily Payments Trend">
        <PaymentsCountChart data={daily} />
      </ChartCard>

      <ChartCard title="Daily Payment Amount">
        <PaymentsAmountChart data={daily} />
      </ChartCard>

      <ChartCard title="Memo Pattern Mix">
        <PaymentsMemoPatternChart data={daily} />
      </ChartCard>

      <div className="grid gap-6 xl:grid-cols-3">
        <CounterpartyList title="Top Recipients By Amount" rows={topRecipientsByAmount} />
        <CounterpartyList title="Top Recipients By Count" rows={topRecipientsByCount} />
        <CounterpartyList title="Top Senders" rows={topSenders} />
      </div>
    </div>
  )
}
