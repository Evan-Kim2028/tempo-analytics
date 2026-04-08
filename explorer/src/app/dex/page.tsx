import { getDexDailyVolumeUSD, getTopPools } from '@/lib/analytics'
import { DexVolumeChart } from '@/components/charts/DexVolumeChart'

export const revalidate = 900

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
  }).format(n)

const fmtCount = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

export default async function DexPage() {
  const [daily, pools] = await Promise.all([
    getDexDailyVolumeUSD(30),
    getTopPools(10),
  ])

  const totalVol30d = daily.reduce((s, d) => s + d.volume_usd, 0)
  const totalSwaps30d = daily.reduce((s, d) => s + d.swap_count, 0)

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-1">DEX</h1>
        <p className="text-tempo-muted text-sm">
          Uniswap V2-compatible swaps on Tempo Mainnet. USD volume shown for pools
          with at least one{' '}
          <a href="https://tokenlist.tempo.xyz" className="text-tempo-blue hover:underline" target="_blank" rel="noopener">
            verified token ↗
          </a>
          .
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">30d Volume (whitelisted pools)</p>
          <p className="text-2xl font-semibold text-white">{fmtUSD(totalVol30d)}</p>
        </div>
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">30d Swaps (all pools)</p>
          <p className="text-2xl font-semibold text-white">{fmtCount(totalSwaps30d)}</p>
        </div>
      </div>

      {/* Daily volume chart */}
      {daily.length > 0 && (
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-6 mb-8">
          <h2 className="text-base font-medium text-white mb-4">Daily USD Volume (30d)</h2>
          <DexVolumeChart data={daily} />
        </div>
      )}

      {/* Top pools table */}
      <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-tempo-border">
          <h2 className="text-base font-medium text-white">Top Pools (30d)</h2>
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
    </main>
  )
}
