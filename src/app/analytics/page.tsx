import {
  getDailyStats,
  getStablecoinStats,
  getStablecoinDailyVolume,
  getProtocolDexDailyStats,
  getDexDailyVolumeUSD,
  type DexDailyVolumeUSD,
} from '@/lib/analytics'
import { getProtocolDexTVL } from '@/lib/defi'
import { StatCard } from '@/components/StatCard'
import { TempoFeaturesChart } from '@/components/charts/TempoFeaturesChart'
import { StablecoinVolumeChart } from '@/components/charts/StablecoinVolumeChart'
import { DexVolumeChart } from '@/components/charts/DexVolumeChart'

export const revalidate = 900

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
  }).format(n)

const fmtCount = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

export default async function AnalyticsPage() {
  const [daily, stablecoinStats, stablecoinDaily, protocolDaily, protocolTVL, communityDaily] = await Promise.all([
    getDailyStats(30),
    getStablecoinStats(),
    getStablecoinDailyVolume(30),
    getProtocolDexDailyStats(30),
    getProtocolDexTVL(),
    getDexDailyVolumeUSD(30),
  ])

  // AA Features aggregates (30d)
  const batchTxs30d = daily.reduce((s, d) => s + d.batch_txs, 0)
  const sponsoredTxs30d = daily.reduce((s, d) => s + d.sponsored_txs, 0)

  // Stablecoin aggregates
  const totalSupply = stablecoinStats.reduce((s, t) => s + (t.supply ?? 0), 0)
  const totalVol30d = stablecoinStats.reduce((s, t) => s + t.volume_30d, 0)
  const totalXfers30d = stablecoinStats.reduce((s, t) => s + t.transfers_30d, 0)

  // Protocol DEX aggregates
  const protocolSwaps30d = protocolDaily.reduce((s, d) => s + d.swaps, 0)
  const protocolVol30d = protocolDaily.reduce((s, d) => s + d.volume_usd, 0)

  // Protocol DEX chart data (adapt to DexDailyVolumeUSD shape)
  const protocolForChart: DexDailyVolumeUSD[] = protocolDaily.map(d => ({
    day: d.day,
    volume_usd: d.volume_usd,
    swap_count: d.swaps,
  }))

  // Community DEX aggregates
  const communityVol30d = communityDaily.reduce((s, d) => s + d.volume_usd, 0)
  const communitySwaps30d = communityDaily.reduce((s, d) => s + d.swap_count, 0)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-1">Overview</h1>
        <p className="text-tempo-muted text-sm">Key metrics across Tempo Mainnet</p>
      </div>

      {/* ── Section 1: AA Features ── */}
      <section className="mb-12">
        <h2 className="text-lg font-semibold text-white mb-4">AA Features</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <StatCard label="Batch Call Txs (30d)" value={fmtCount(batchTxs30d)} />
          <StatCard label="Sponsored Txs (30d)" value={fmtCount(sponsoredTxs30d)} />
        </div>

        <div className="bg-tempo-card border border-tempo-border rounded-lg p-6">
          <h3 className="text-sm font-medium text-white mb-4">Daily Batch &amp; Sponsored Txs (30d)</h3>
          <TempoFeaturesChart data={daily} />
        </div>
      </section>

      {/* ── Section 2: Stablecoins ── */}
      <section className="mb-12">
        <h2 className="text-lg font-semibold text-white mb-4">Stablecoins</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <StatCard label="Total Supply" value={fmtUSD(totalSupply)} />
          <StatCard label="30d Volume" value={fmtUSD(totalVol30d)} />
          <StatCard label="30d Transfers" value={fmtCount(totalXfers30d)} />
        </div>

        <div className="bg-tempo-card border border-tempo-border rounded-lg p-6 mb-4">
          <h3 className="text-sm font-medium text-white mb-4">Daily Transfer Volume (30d)</h3>
          <StablecoinVolumeChart data={stablecoinDaily} />
        </div>

        <a href="/stablecoins" className="text-tempo-blue hover:underline text-sm">
          View Stablecoins →
        </a>
      </section>

      {/* ── Section 3: Protocol DEX (Enshrined) ── */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-lg font-semibold text-white">Protocol DEX</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">Enshrined</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <StatCard label="30d Swaps" value={fmtCount(protocolSwaps30d)} />
          <StatCard label="30d Volume" value={fmtUSD(protocolVol30d)} />
          <StatCard label="TVL" value={fmtUSD(protocolTVL)} sub="stablecoins held by precompile" />
        </div>

        <div className="bg-tempo-card border border-tempo-border rounded-lg p-6 mb-4">
          <h3 className="text-sm font-medium text-white mb-4">Daily Volume (30d)</h3>
          <DexVolumeChart data={protocolForChart} color="#8B5CF6" />
        </div>

        <a href="/dex" className="text-tempo-blue hover:underline text-sm">
          View DEX →
        </a>
      </section>

      {/* ── Section 4: Community DEX ── */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-lg font-semibold text-white">Community DEX</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">Uniswap V2</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <StatCard label="30d Volume (whitelisted pools)" value={fmtUSD(communityVol30d)} />
          <StatCard label="30d Swaps" value={fmtCount(communitySwaps30d)} />
        </div>

        <div className="bg-tempo-card border border-tempo-border rounded-lg p-6 mb-4">
          <h3 className="text-sm font-medium text-white mb-4">Daily USD Volume (30d)</h3>
          <DexVolumeChart data={communityDaily} />
        </div>

        <a href="/dex" className="text-tempo-blue hover:underline text-sm">
          View DEX →
        </a>
      </section>
    </div>
  )
}
