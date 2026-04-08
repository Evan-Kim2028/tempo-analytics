import { getStablecoinStats, getStablecoinDailyVolume } from '@/lib/analytics'
import { StablecoinTVLChart } from '@/components/charts/StablecoinTVLChart'

export const revalidate = 900

const fmtUSD = (n: number | null) =>
  n === null ? '—' : new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
  }).format(n)

const fmtCount = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

export default async function StablecoinsPage() {
  const [stats, daily] = await Promise.all([
    getStablecoinStats(),
    getStablecoinDailyVolume(30),
  ])

  const totalSupply = stats.reduce((s, t) => s + (t.supply ?? 0), 0)
  const totalVol30d = stats.reduce((s, t) => s + t.volume_30d, 0)
  const totalXfers30d = stats.reduce((s, t) => s + t.transfers_30d, 0)

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-1">Stablecoins</h1>
        <p className="text-tempo-muted text-sm">
          Verified stablecoins on Tempo Mainnet.{' '}
          <a href="https://tokenlist.tempo.xyz" className="text-tempo-blue hover:underline" target="_blank" rel="noopener">
            Token registry ↗
          </a>
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">Total Circulating Supply</p>
          <p className="text-2xl font-semibold text-white">{fmtUSD(totalSupply)}</p>
          <p className="text-tempo-muted text-xs mt-1">{stats.length} stablecoins</p>
        </div>
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">30d Transfer Volume</p>
          <p className="text-2xl font-semibold text-white">{fmtUSD(totalVol30d)}</p>
        </div>
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-5">
          <p className="text-tempo-muted text-xs mb-1">30d Transfers</p>
          <p className="text-2xl font-semibold text-white">{fmtCount(totalXfers30d)}</p>
        </div>
      </div>

      {/* Daily volume chart */}
      {daily.length > 0 && (
        <div className="bg-tempo-card border border-tempo-border rounded-lg p-6 mb-8">
          <h2 className="text-base font-medium text-white mb-4">
            Daily Transfer Volume — pathUSD & USDC.e (30d)
          </h2>
          <StablecoinTVLChart data={daily} />
        </div>
      )}

      {/* Stablecoin table */}
      <div className="bg-tempo-card border border-tempo-border rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-tempo-border">
          <h2 className="text-base font-medium text-white">All Stablecoins</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-tempo-border">
                <th className="text-left px-6 py-3 text-tempo-muted font-normal">Token</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">Supply</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">24h Vol</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">7d Vol</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">30d Vol</th>
                <th className="text-right px-4 py-3 text-tempo-muted font-normal">30d Transfers</th>
                <th className="text-right px-6 py-3 text-tempo-muted font-normal">Fee Txs (30d)</th>
              </tr>
            </thead>
            <tbody>
              {stats
                .sort((a, b) => b.volume_30d - a.volume_30d)
                .map(token => (
                  <tr key={token.address} className="border-b border-tempo-border hover:bg-tempo-border/30 transition-colors">
                    <td className="px-6 py-4">
                      <a href={`/address/${token.address}`} className="hover:underline">
                        <span className="text-white font-medium">{token.symbol}</span>
                        <span className="text-tempo-muted ml-2 text-xs">{token.name}</span>
                      </a>
                      <div className="font-mono text-xs text-tempo-muted mt-0.5">
                        {token.address.slice(0, 10)}…{token.address.slice(-6)}
                      </div>
                    </td>
                    <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(token.supply)}</td>
                    <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(token.volume_24h)}</td>
                    <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(token.volume_7d)}</td>
                    <td className="text-right px-4 py-4 text-white font-mono">{fmtUSD(token.volume_30d)}</td>
                    <td className="text-right px-4 py-4 text-tempo-muted">{fmtCount(token.transfers_30d)}</td>
                    <td className="text-right px-6 py-4 text-tempo-muted">
                      {token.fee_txs_30d > 0 ? fmtCount(token.fee_txs_30d) : '—'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
