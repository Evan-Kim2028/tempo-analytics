import { StatCard } from '@/components/StatCard'
import type { MicropaymentStatsSummary } from '@/lib/payments'

const countFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
})

export function MicropaymentsSummary({ summary }: { summary: MicropaymentStatsSummary }) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Micropayment Share"
        value={`${summary.micro_share_pct}%`}
        sub="of all successful payments (30d)"
      />
      <StatCard
        label="Micropayments"
        value={countFormatter.format(summary.micro_count)}
        sub="transactions under $0.10 (30d)"
      />
      <StatCard
        label="Sub-cent Transactions"
        value={countFormatter.format(summary.sub_cent_count)}
        sub="payments under $0.01 (30d)"
      />
      <StatCard
        label="Micropayment Volume"
        value={usdFormatter.format(summary.micro_amount)}
        sub="total USD under $0.10 (30d)"
      />
    </section>
  )
}
