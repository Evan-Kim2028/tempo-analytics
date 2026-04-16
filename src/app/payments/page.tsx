import { PaymentsNarrative } from '@/components/payments/PaymentsNarrative'
import { PaymentsSummary } from '@/components/payments/PaymentsSummary'
import { MicropaymentsSummary } from '@/components/payments/MicropaymentsSummary'
import { MicropaymentTierChart } from '@/components/charts/MicropaymentTierChart'
import { MicropaymentVsLargeChart } from '@/components/charts/MicropaymentVsLargeChart'
import { RecentPaymentsTable } from '@/components/payments/RecentPaymentsTable'
import { getPaymentsPageData } from '@/lib/payments'

export const revalidate = 900

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-tempo-card border border-tempo-border rounded-lg p-5">
      <h2 className="text-lg font-medium text-white mb-4">{title}</h2>
      {children}
    </section>
  )
}

export default async function PaymentsPage() {
  const data = await getPaymentsPageData()

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-white">Payments</h1>
            <p className="max-w-3xl text-sm text-tempo-muted">
              TIP-20 transferWithMemo activity across verified stablecoins
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-tempo-border bg-tempo-card px-3 py-1 text-xs text-tempo-muted">
            Updates every 15 min · Mainnet data
          </span>
        </div>
      </header>

      <section className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Micropayments</h2>
        <MicropaymentsSummary summary={data.micropaymentStats.summary} />
        <div className="grid gap-6 xl:grid-cols-2">
          <ChartCard title="Micropayment Transactions by Tier (30d)">
            <MicropaymentTierChart data={data.micropaymentStats.daily} />
          </ChartCard>
          <ChartCard title="Micropayments vs Large Payments (30d)">
            <MicropaymentVsLargeChart data={data.micropaymentStats.daily} />
          </ChartCard>
        </div>
      </section>

      <PaymentsSummary summary={data.summary} />
      <PaymentsNarrative
        daily={data.daily}
        dailyByToken={data.dailyByToken}
        topRecipientsByAmount={data.topRecipientsByAmount}
        topRecipientsByCount={data.topRecipientsByCount}
        topSenders={data.topSenders}
      />
      <RecentPaymentsTable rows={data.recent} />
    </div>
  )
}
