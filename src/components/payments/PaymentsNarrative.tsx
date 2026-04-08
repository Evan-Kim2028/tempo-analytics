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
    <section className="bg-tempo-card border border-tempo-border rounded-lg p-5">
      <h2 className="text-lg font-medium text-white mb-4">{title}</h2>
      <div className="space-y-3">
        {rows.map(row => (
          <div key={row.address} className="flex items-center justify-between gap-4 text-sm">
            <span className="font-mono text-white">{row.address}</span>
            <span className="text-tempo-muted">{row.payment_count} payments · ${row.total_amount.toFixed(2)}</span>
          </div>
        ))}
      </div>
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
