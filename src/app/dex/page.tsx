import {
  getDexDailyVolumeUSD,
  getTopPools,
  getFeeTokenAllDailyStats,
  getFeeTokenAmountDailyStats,
  getProtocolDexDailyStats,
  getProtocolDexTokenDailyStats,
  getProtocolDexPools,
  type DexDailyVolumeUSD,
} from '@/lib/analytics'
import { DexVolumeChart } from '@/components/charts/DexVolumeChart'
import { FeeTokenAllChart } from '@/components/charts/FeeTokenAllChart'
import { FeeTokenAmountChart } from '@/components/charts/FeeTokenAmountChart'
import { ProtocolDexTokenChart } from '@/components/charts/ProtocolDexTokenChart'
import { getProtocolDexTVL, getCommunityDexTVL } from '@/lib/defi'
import { StatCard } from '@/components/StatCard'
import { ProtocolDexPoolExplorer } from '@/components/ProtocolDexPoolExplorer'
import { PeriodToggle } from '@/components/PeriodToggle'
import { ExportButton } from '@/components/ExportButton'
import { Suspense } from 'react'

export const revalidate = 900

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
  }).format(n)

const fmtCount = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

const fmtPct = (n: number, total: number) =>
  total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '—'

function parseDays(raw: string | undefined): number {
  const n = Number(raw)
  return [1, 7, 30].includes(n) ? n : 30
}

export default async function DexPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const { days: rawDays } = await searchParams
  const days = parseDays(rawDays)

  const [feeData, feeAmountData, protocolDaily, protocolTokenData, communityDaily, pools, protocolTVL, communityTVL, protocolDexPools] = await Promise.all([
    getFeeTokenAllDailyStats(days),
    getFeeTokenAmountDailyStats(days),
    getProtocolDexDailyStats(days),
    getProtocolDexTokenDailyStats(days),
    getDexDailyVolumeUSD(days),
    getTopPools(10),
    getProtocolDexTVL(),
    getCommunityDexTVL(),
    getProtocolDexPools(days),
  ])

  // Fee AMM aggregates (derived from all-token breakdown)
  const feeTotal   = feeData.tokens.reduce((s, t) => s + t.total, 0)
  const USDC_E  = '0x20c000000000000000000000b9537d11c60e8b50'
  const PATHUSD = '0x20c0000000000000000000000000000000000000'
  const feeUsdcE   = feeData.tokens.find(t => t.address === USDC_E)?.total ?? 0
  const feePathusd = feeData.tokens.find(t => t.address === PATHUSD)?.total ?? 0

  // Protocol DEX aggregates
  const protocolSwaps = protocolDaily.reduce((s, d) => s + d.swaps, 0)
  const protocolVol   = protocolDaily.reduce((s, d) => s + d.volume_usd, 0)

  // Community DEX aggregates
  const communityVol   = communityDaily.reduce((s, d) => s + d.volume_usd, 0)
  const communitySwaps = communityDaily.reduce((s, d) => s + d.swap_count, 0)

  const periodLabel = days === 1 ? '1d' : days === 7 ? '7d' : '30d'

  // DexVolumeChart expects DexDailyVolumeUSD shape; adapt protocol stats
  const protocolForChart: DexDailyVolumeUSD[] = protocolDaily.map(d => ({
    day: d.day,
    volume_usd: d.volume_usd,
    swap_count: d.swaps,
  }))

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white mb-1">DEX</h1>
          <p className="text-tempo-muted text-sm">
            Tempo has three exchange mechanisms: Fee AMM, Protocol DEX, and Community DEX — each serving a different purpose.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton queryKey="dex-daily" label="Export CSV" />
          <Suspense>
            <PeriodToggle currentDays={days} />
          </Suspense>
        </div>
      </div>

      {/* ── Section 1: Fee AMM ── */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-white">Fee AMM</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Enshrined</span>
        </div>
        <p className="text-tempo-muted text-sm mb-6">
          Users pay gas fees in any verified stablecoin. At block settlement, the protocol auto-converts
          to the block validator&apos;s preferred token using a dedicated low-slippage AMM — no separate gas
          token needed. Designed by{' '}
          <a href="https://www.paradigm.xyz/" className="text-tempo-blue hover:underline" target="_blank" rel="noopener noreferrer">
            Dan Robinson (Paradigm)↗
          </a>
          .
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <StatCard label={`Fee-bearing Txs (${periodLabel})`} value={fmtCount(feeTotal)} />
          <StatCard label={`USDC.e Share (${periodLabel})`} value={fmtPct(feeUsdcE, feeTotal)} sub={`${fmtCount(feeUsdcE)} txs`} />
          <StatCard label={`pathUSD Share (${periodLabel})`} value={fmtPct(feePathusd, feeTotal)} sub={`${fmtCount(feePathusd)} txs`} />
        </div>

        {feeData.days.length > 0 && (
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-6">
            <h3 className="text-sm font-medium text-white mb-4">Daily Fee Token Usage ({periodLabel})</h3>
            <FeeTokenAllChart data={feeData} />
          </div>
        )}

        {feeAmountData.days.length > 0 && (
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-6 mt-4">
            <h3 className="text-sm font-medium text-white mb-4">Daily Fee Token Amount — USD ({periodLabel})</h3>
            <FeeTokenAmountChart data={feeAmountData} />
          </div>
        )}
      </section>

      {/* ── Section 2: Protocol DEX (Enshrined) ── */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-white">Protocol DEX</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">Enshrined</span>
        </div>
        <p className="text-tempo-muted text-sm mb-6">
          Protocol-level stablecoin exchange at precompile{' '}
          <a href="/address/0xdec0000000000000000000000000000000000000" className="font-mono text-tempo-blue hover:underline text-xs">
            0xdec0…0000
          </a>
          . All stablecoin swaps route through pathUSD as the central quote token.
          Supports both orderbook-style settlement and constant-product AMM liquidity.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <StatCard label="TVL" value={fmtUSD(protocolTVL)} sub="stablecoins held by precompile" />
          <StatCard label={`${periodLabel} Volume`} value={fmtUSD(protocolVol)} />
          <StatCard label={`${periodLabel} Swaps`} value={fmtCount(protocolSwaps)} />
        </div>

        {protocolForChart.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-tempo-card border border-tempo-border rounded-lg p-6">
              <h3 className="text-sm font-medium text-white mb-4">Daily Volume ({periodLabel})</h3>
              <DexVolumeChart data={protocolForChart} color="#8B5CF6" />
            </div>
            <div className="bg-tempo-card border border-tempo-border rounded-lg p-6">
              <h3 className="text-sm font-medium text-white mb-4">Volume by Token ({periodLabel})</h3>
              <ProtocolDexTokenChart data={protocolTokenData} />
            </div>
          </div>
        )}
      </section>

      {/* ── Section 3: Community DEX (Uniswap V2) ── */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-white">Community DEX</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">Uniswap V2</span>
        </div>
        <p className="text-tempo-muted text-sm mb-6">
          Community-deployed Uniswap V2-compatible AMM pools. USD volume shown for pools
          with at least one{' '}
          <a href="https://tokenlist.tempo.xyz" className="text-tempo-blue hover:underline" target="_blank" rel="noopener noreferrer">
            verified token ↗
          </a>
          .
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <StatCard label="TVL" value={fmtUSD(communityTVL)} sub="top 10 pools, stablecoin-side ×2" />
          <StatCard label={`${periodLabel} Volume (whitelisted pools)`} value={fmtUSD(communityVol)} />
          <StatCard label={`${periodLabel} Swaps (all pools)`} value={fmtCount(communitySwaps)} />
        </div>

        {communityDaily.length > 0 && (
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-6 mb-6">
            <h3 className="text-sm font-medium text-white mb-4">Daily USD Volume ({periodLabel})</h3>
            <DexVolumeChart data={communityDaily} />
          </div>
        )}

        <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-tempo-border">
            <h3 className="text-base font-medium text-white">Top Pools ({periodLabel})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-tempo-border">
                  <th className="text-left px-6 py-3 text-tempo-muted font-normal">Pair</th>
                  <th className="text-right px-4 py-3 text-tempo-muted font-normal">{periodLabel} Volume</th>
                  <th className="text-right px-6 py-3 text-tempo-muted font-normal">{periodLabel} Swaps</th>
                </tr>
              </thead>
              <tbody>
                {pools.map(pool => (
                  <tr key={pool.pair} className="border-b border-tempo-border hover:bg-tempo-border/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">
                          {pool.token0Symbol} / {pool.token1Symbol}
                        </span>
                      </div>
                      <a href={`/address/${pool.pair}`} className="font-mono text-xs text-tempo-blue hover:underline">
                        {pool.pair.slice(0, 10)}…{pool.pair.slice(-6)}
                      </a>
                    </td>
                    <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(pool.volume_usd_30d)}</td>
                    <td className="text-right px-6 py-4 text-tempo-muted">{fmtCount(pool.swaps_30d)}</td>
                  </tr>
                ))}
                {pools.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-tempo-muted text-sm">
                      No whitelisted pools found. Check RPC connectivity.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Section 4: Protocol DEX Pool Explorer ── */}
      <section className="mt-12">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-white">Protocol DEX Pools</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">Enshrined</span>
        </div>
        <p className="text-tempo-muted text-sm mb-6">
          Per-pool breakdown of the enshrined Protocol DEX. Click any row to see recent trades.
          Volume shown only for pools with a{' '}
          <a href="https://tokenlist.tempo.xyz" className="text-tempo-blue hover:underline" target="_blank" rel="noopener noreferrer">
            verified token ↗
          </a>
          .
        </p>
        <ProtocolDexPoolExplorer pools={protocolDexPools} />
      </section>
    </main>
  )
}
