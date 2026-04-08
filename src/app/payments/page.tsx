import { PaymentsNarrative } from '@/components/payments/PaymentsNarrative'
import { PaymentsSummary } from '@/components/payments/PaymentsSummary'
import { RecentPaymentsTable } from '@/components/payments/RecentPaymentsTable'
import { getPaymentsPageData } from '@/lib/payments'

export const revalidate = 900

export default async function PaymentsPage() {
  const data = await getPaymentsPageData()

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-white">Payments</h1>
            <p className="max-w-3xl text-sm text-tempo-muted">
              memo-bearing payment activity across Tempo
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-tempo-border bg-tempo-card px-3 py-1 text-xs text-tempo-muted">
            Updates every 15 min · Mainnet data
          </span>
        </div>
      </header>

      <PaymentsSummary summary={data.summary} />
      <PaymentsNarrative
        daily={data.daily}
        topRecipientsByAmount={data.topRecipientsByAmount}
        topRecipientsByCount={data.topRecipientsByCount}
        topSenders={data.topSenders}
      />
      <RecentPaymentsTable rows={data.recent} />
    </div>
  )
}
