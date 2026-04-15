import { StatCard } from '@/components/StatCard'
import type { PaymentsSummaryStats } from '@/lib/payments'

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

export function PaymentsSummary({ summary }: { summary: PaymentsSummaryStats }) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
      <StatCard label="Successful Payments" value={countFormatter.format(summary.successful_payments)} />
      <StatCard label="Failed Attempts" value={countFormatter.format(summary.failed_attempts)} />
      <StatCard label="Success Rate" value={`${summary.success_rate}%`} />
      <StatCard label="Total Payment Amount" value={usdFormatter.format(summary.total_amount)} />
      <StatCard label="Unique Senders" value={countFormatter.format(summary.unique_senders)} />
      <StatCard label="Unique Recipients" value={countFormatter.format(summary.unique_recipients)} />
    </section>
  )
}
