import {
  getDailyStats, getSignatureTypeStats, getNetworkSummary,
} from '@/lib/analytics'
import { StatCard } from '@/components/StatCard'
import { ActivityChart } from '@/components/charts/ActivityChart'
import { TempoFeaturesChart } from '@/components/charts/TempoFeaturesChart'
import { SigTypePie } from '@/components/charts/SigTypePie'
import { ExportButton } from '@/components/ExportButton'

export const revalidate = 900 // 15 min

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-tempo-card border border-tempo-border rounded-lg p-6">
      <h2 className="text-sm font-medium text-tempo-muted uppercase tracking-wide mb-4">{title}</h2>
      {children}
    </div>
  )
}

export default async function AnalyticsPage() {
  const [daily, sigTypes, summary] = await Promise.all([
    getDailyStats(30),
    getSignatureTypeStats(),
    getNetworkSummary(),
  ])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-white">Analytics</h1>
        <span className="text-tempo-muted text-xs">Updates every 15 min · Mainnet data</span>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <StatCard label="Total Transactions" value={summary.total_txs.toLocaleString()} />
        <StatCard label="Unique Addresses" value={summary.total_addresses.toLocaleString()} />
        <StatCard label="Contracts Deployed" value={summary.contract_deployments.toLocaleString()} />
        <StatCard label="Batch Txs" value={summary.batch_txs.toLocaleString()} />
        <StatCard label="Sponsored Txs" value={summary.sponsored_txs.toLocaleString()} />
      </div>

      {/* Daily activity — 30-day line chart */}
      <div className="mb-6">
        <ChartCard title="Daily Activity — last 30 days">
          <ActivityChart data={daily} />
        </ChartCard>
      </div>

      {/* Tempo-specific features + sig types */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <ChartCard title="Tempo AA Features — batch calls & sponsorship">
          <TempoFeaturesChart data={daily} />
        </ChartCard>
        <ChartCard title="Signature Types — all time">
          <SigTypePie data={sigTypes} />
        </ChartCard>
      </div>

      {/* Data export */}
      <div className="bg-tempo-card border border-tempo-border rounded-lg p-6">
        <h2 className="text-sm font-medium text-tempo-muted uppercase tracking-wide mb-4">Export Raw Data</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {([
            { key: 'account-types', label: 'Account Type Breakdown', desc: 'Secp256k1 / P256 / WebAuthn distribution' },
            { key: 'batch-calls', label: 'Batch Call Stats', desc: 'Batch transactions per day' },
            { key: 'fee-sponsorship', label: 'Fee Sponsorship', desc: 'Sponsored transaction breakdown' },
          ] as const).map(({ key, label, desc }) => (
            <div key={key} className="flex flex-col gap-2">
              <p className="text-white text-sm font-medium">{label}</p>
              <p className="text-tempo-muted text-xs">{desc}</p>
              <ExportButton queryKey={key} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
