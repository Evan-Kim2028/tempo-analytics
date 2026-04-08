import {
  getDexDailyVolumeUSD,
  getTopPools,
  getFeeTokenDailyStats,
  getProtocolDexDailyStats,
  type DexDailyVolumeUSD,
} from '@/lib/analytics'
import { DexVolumeChart } from '@/components/charts/DexVolumeChart'
import { FeeAmmChart } from '@/components/charts/FeeAmmChart'

export const revalidate = 900

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
  }).format(n)

const fmtCount = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

const fmtPct = (n: number, total: number) =>
  total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '—'

export default async function DexPage() {
  const [feeDaily, protocolDaily, communityDaily, pools] = await Promise.all([
    getFeeTokenDailyStats(30),
    getProtocolDexDailyStats(30),
    getDexDailyVolumeUSD(30),
    getTopPools(10),
  ])

  // Fee AMM aggregates
  const feeTotal30d   = feeDaily.reduce((s, d) => s + d.total, 0)
  const feeUsdcE30d   = feeDaily.reduce((s, d) => s + d.usdc_e, 0)
  const feePathusd30d = feeDaily.reduce((s, d) => s + d.pathusd, 0)

  // Protocol DEX aggregates
  const protocolSwaps30d = protocolDaily.reduce((s, d) => s + d.swaps, 0)
  const protocolVol30d   = protocolDaily.reduce((s, d) => s + d.volume_usd, 0)

  // Community DEX aggregates
  const communityVol30d   = communityDaily.reduce((s, d) => s + d.volume_usd, 0)
  const communitySwaps30d = communityDaily.reduce((s, d) => s + d.swap_count, 0)

  // DexVolumeChart expects DexDailyVolumeUSD shape; adapt protocol stats
  const protocolForChart: DexDailyVolumeUSD[] = protocolDaily.map(d => ({
    day: d.day,
    volume_usd: d.volume_usd,
    swap_count: d.swaps,
  }))

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-1">DEX</h1>
        <p className="text-tempo-muted text-sm">
          Tempo has three exchange mechanisms: Fee AMM, Protocol DEX, and Community DEX — each serving a different purpose.
        </p>
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
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
            <p className="text-tempo-muted text-xs mb-1">Fee-bearing Txs (30d)</p>
            <p className="text-2xl font-semibold text-white">{fmtCount(feeTotal30d)}</p>
          </div>
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
            <p className="text-tempo-muted text-xs mb-1">USDC.e Share (30d)</p>
            <p className="text-2xl font-semibold text-white">{fmtPct(feeUsdcE30d, feeTotal30d)}</p>
            <p className="text-tempo-muted text-xs mt-1">{fmtCount(feeUsdcE30d)} txs</p>
          </div>
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
            <p className="text-tempo-muted text-xs mb-1">pathUSD Share (30d)</p>
            <p className="text-2xl font-semibold text-white">{fmtPct(feePathusd30d, feeTotal30d)}</p>
            <p className="text-tempo-muted text-xs mt-1">{fmtCount(feePathusd30d)} txs</p>
          </div>
        </div>

        {feeDaily.length > 0 && (
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-6">
            <h3 className="text-sm font-medium text-white mb-4">Daily Fee Token Usage (30d)</h3>
            <FeeAmmChart data={feeDaily} />
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
            <p className="text-tempo-muted text-xs mb-1">30d Swaps</p>
            <p className="text-2xl font-semibold text-white">{fmtCount(protocolSwaps30d)}</p>
          </div>
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
            <p className="text-tempo-muted text-xs mb-1">30d Volume</p>
            <p className="text-2xl font-semibold text-white">{fmtUSD(protocolVol30d)}</p>
          </div>
        </div>

        {protocolForChart.length > 0 && (
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-6">
            <h3 className="text-sm font-medium text-white mb-4">Daily Volume (30d)</h3>
            <DexVolumeChart data={protocolForChart} />
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
            <p className="text-tempo-muted text-xs mb-1">30d Volume (whitelisted pools)</p>
            <p className="text-2xl font-semibold text-white">{fmtUSD(communityVol30d)}</p>
          </div>
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
            <p className="text-tempo-muted text-xs mb-1">30d Swaps (all pools)</p>
            <p className="text-2xl font-semibold text-white">{fmtCount(communitySwaps30d)}</p>
          </div>
        </div>

        {communityDaily.length > 0 && (
          <div className="bg-tempo-card border border-tempo-border rounded-lg p-6 mb-6">
            <h3 className="text-sm font-medium text-white mb-4">Daily USD Volume (30d)</h3>
            <DexVolumeChart data={communityDaily} />
          </div>
        )}

        <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-tempo-border">
            <h3 className="text-base font-medium text-white">Top Pools (30d)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-tempo-border">
                  <th className="text-left px-6 py-3 text-tempo-muted font-normal">Pair</th>
                  <th className="text-right px-4 py-3 text-tempo-muted font-normal">30d Volume</th>
                  <th className="text-right px-6 py-3 text-tempo-muted font-normal">30d Swaps</th>
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
    </main>
  )
}
