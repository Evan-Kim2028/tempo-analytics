import {
  getDailyStats, getSignatureTypeStats, getNetworkSummary, getDailyStatsCategorized,
  getStablecoinDailyVolume, getDexDailyActivity, getTopDexPairs,
  getTopNFTCollections,
} from '@/lib/analytics'
import { getInscriptionTotals } from '@/lib/inscriptions'
import { StatCard } from '@/components/StatCard'
import { ActivityChart } from '@/components/charts/ActivityChart'
import { TempoFeaturesChart } from '@/components/charts/TempoFeaturesChart'
import { SigTypePie } from '@/components/charts/SigTypePie'
import { TxCategoryChart } from '@/components/charts/TxCategoryChart'
import { InscriptionChart } from '@/components/charts/InscriptionChart'
import { StablecoinVolumeChart } from '@/components/charts/StablecoinVolumeChart'
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
  const [daily, sigTypes, summary, categorized, inscriptionTotals, stablecoins, dexDaily, topPairs, topNFTs] = await Promise.all([
    getDailyStats(30),
    getSignatureTypeStats(),
    getNetworkSummary(),
    getDailyStatsCategorized(30),
    getInscriptionTotals(),
    getStablecoinDailyVolume(30),
    getDexDailyActivity(30),
    getTopDexPairs(10),
    getTopNFTCollections(10),
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

      {/* Transaction category breakdown */}
      <div className="mb-6">
        <ChartCard title="Transaction Breakdown — user vs protocol vs inscriptions">
          <p className="text-tempo-muted text-xs mb-3">
            ~84% of Tempo transactions are protocol-level operations (block records, consensus).
            User and inscription activity is shown separately.
          </p>
          <TxCategoryChart data={categorized} />
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

      {/* TIP-20 inscriptions */}
      {inscriptionTotals.length > 0 && (
        <div className="mb-8">
          <ChartCard title="TIP-20 Inscriptions — all-time mint volume by ticker">
            <p className="text-tempo-muted text-xs mb-3">
              TIP-20 inscriptions use JSON calldata — the BRC-20 pattern on Tempo.
              Tickers like TEMP, MEME, and tempodz have active mint communities.
            </p>
            <InscriptionChart totals={inscriptionTotals} />
          </ChartCard>
        </div>
      )}

      {/* Stablecoin transfer volume */}
      <div className="mb-6">
        <ChartCard title="Stablecoin Transfer Volume — pathUSD & USDC.e daily">
          <p className="text-tempo-muted text-xs mb-3">
            pathUSD (supply: ~$3.94M) and USDC.e (supply: ~$2.54M) are the primary fee-paying
            stablecoins. High velocity: total on-chain volume far exceeds supply.
          </p>
          <StablecoinVolumeChart data={stablecoins} />
        </ChartCard>
      </div>

      {/* DEX + NFT side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <ChartCard title="DEX Activity — daily swaps (Uniswap V2-compatible)">
          <p className="text-tempo-muted text-xs mb-3">
            Community-deployed V2 AMMs. Top pair: TIMECOIN/USDC.e.
            USD volume tracking requires per-pair token mapping (coming soon).
          </p>
          {topPairs.length > 0 && (
            <div className="mt-4 space-y-1">
              {topPairs.map(p => (
                <div key={p.pair} className="flex justify-between text-xs">
                  <a href={`/address/${p.pair}`} className="font-mono text-tempo-blue hover:underline">
                    {p.pair.slice(0, 10)}…{p.pair.slice(-6)}
                  </a>
                  <span className="text-tempo-muted">{p.total_swaps.toLocaleString()} swaps</span>
                </div>
              ))}
            </div>
          )}
        </ChartCard>

        <ChartCard title="NFT Activity — top ERC-721 collections">
          <div className="space-y-2">
            {topNFTs.map(c => (
              <div key={c.collection} className="flex items-center justify-between text-xs">
                <a href={`/address/${c.collection}`} className="font-mono text-tempo-blue hover:underline">
                  {c.collection.slice(0, 10)}…{c.collection.slice(-6)}
                </a>
                <div className="text-right">
                  <span className="text-white">{c.total_transfers.toLocaleString()}</span>
                  <span className="text-tempo-muted ml-2">{c.days_active}d active</span>
                </div>
              </div>
            ))}
          </div>
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
